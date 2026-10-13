#!/usr/bin/env python3
"""Build Patiamor's places data from GeoNames' Dominican Republic dump (CC BY 4.0; credit "GeoNames").

Outputs, from one source so they never drift apart:
  migrations/0003_places.sql   places rows for D1 (foreign keys + distance queries)
  src/places/data.json         compact copy bundled into the Worker (autocomplete + nearest-place, no D1 reads)

Usage (from api/):
  curl -o /tmp/DO.zip https://download.geonames.org/export/dump/DO.zip && unzip -o /tmp/DO.zip DO.txt -d /tmp
  python3 -I scripts/build_places.py /tmp/DO.txt

GeoNames hierarchy for the DR: ADM1 province, ADM2 municipio, ADM3 distrito municipal / municipal seat,
ADM4 sección ("(Zona Urbana)" for town centres), ADM5 barrio (urban sección) or paraje (rural).
"""
import json
import re
import sys
import unicodedata
from pathlib import Path

PARTICLES = {'de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'en', 'a'}
PREFIXES = ('ensanche ', 'urbanizacion ', 'residencial ', 'reparto ', 'barrio ', 'sector ', 'ens. ', 'urb. ')
SUFFIXES = (' norte', ' sur', ' este', ' oeste', ' centro', ' arriba', ' abajo', ' adentro', ' afuera')
# Everyday names GeoNames doesn't carry. Keys are generated place ids.
MANUAL_ALIASES: dict[str, list[str]] = {}

KIND_ORDER = {'municipio': 0, 'distrito_municipal': 1, 'barrio': 2, 'paraje': 3}


def strip_accents(s: str) -> str:
    return ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn')


def norm(s: str) -> str:
    return re.sub(r'\s+', ' ', strip_accents(s).lower()).strip()


def slug(s: str) -> str:
    return re.sub(r'[^a-z0-9]+', '-', norm(s)).strip('-')


def smart_case(name: str) -> str:
    words = name.split()
    out = [w if i == 0 or w.lower() not in PARTICLES else w.lower() for i, w in enumerate(words)]
    return ' '.join(out)


def clean_province(name: str) -> str:
    name = re.sub(r'^Provincia (de )?', '', name)
    return re.sub(r' Province$', '', name).strip()


def clean_section(name: str) -> str:
    return smart_case(re.sub(r'\s*\((Zona Urbana|D\. M\.)\)\.?', '', name).strip())


def aliases_for(name: str) -> list[str]:
    n = norm(name)
    found = set()
    for p in PREFIXES:
        if n.startswith(p) and len(n) > len(p) + 2:
            found.add(n[len(p):])
    for s in SUFFIXES:
        for base in [n, *found]:
            if base.endswith(s) and len(base) > len(s) + 2:
                found.add(base[: -len(s)])
    found.discard(n)
    return sorted(found)


def main(path: str) -> None:
    rows = [line.rstrip('\n').split('\t') for line in open(path, encoding='utf-8')]
    # columns: 0 id, 1 name, 4 lat, 5 lng, 7 feature code, 10 admin1, 11 admin2, 12 admin3, 13 admin4
    provinces = {r[10]: clean_province(r[1]) for r in rows if r[7] == 'ADM1'}
    municipios = {r[11]: smart_case(r[1]) for r in rows if r[7] == 'ADM2'}
    sections = {r[13]: r[1] for r in rows if r[7] == 'ADM4'}

    candidates = []
    for r in rows:
        code = r[7]
        if code == 'ADM2':
            kind = 'municipio'
        elif code == 'ADM3' and '(D. M.)' in r[1]:
            kind = 'distrito_municipal'
        elif code == 'ADM5':
            kind = 'barrio' if 'Zona Urbana' in sections.get(r[13], '') else 'paraje'
        else:
            continue
        province = provinces.get(r[10])
        municipality = municipios.get(r[11])
        if not province or not municipality:
            continue
        lat, lng = round(float(r[4]), 5), round(float(r[5]), 5)
        if not (17.3 < lat < 20.1 and -72.1 < lng < -68.2):
            continue
        name = clean_section(r[1]) if kind == 'distrito_municipal' else smart_case(r[1].strip())
        candidates.append({
            'geonames_id': int(r[0]), 'name': name, 'kind': kind, 'municipality': municipality,
            'province': province, 'lat': lat, 'lng': lng, 'section': clean_section(sections.get(r[13], '')),
        })

    # Stable ids: name-province, then name-municipality-province, then + geonames id.
    candidates.sort(key=lambda p: (KIND_ORDER[p['kind']], p['province'], p['municipality'], p['name'], p['geonames_id']))
    dup_in_muni: dict[tuple, int] = {}
    for p in candidates:
        key = (norm(p['name']), p['municipality'], p['province'])
        dup_in_muni[key] = dup_in_muni.get(key, 0) + 1
    used: set[str] = set()
    places = []
    for p in candidates:
        for pid in (f"{slug(p['name'])}-{slug(p['province'])}",
                    f"{slug(p['name'])}-{slug(p['municipality'])}-{slug(p['province'])}",
                    f"{slug(p['name'])}-{slug(p['municipality'])}-{p['geonames_id']}"):
            if pid not in used:
                break
        used.add(pid)
        p['id'] = pid
        p['aliases'] = sorted(set(aliases_for(p['name']) + MANUAL_ALIASES.get(pid, [])))
        # Only repeated names need the sección as a tiebreaker ("La Esperanza · Las Lagunas").
        dup = dup_in_muni[(norm(p['name']), p['municipality'], p['province'])] > 1
        p['hint'] = p['section'] if dup and p['section'] and norm(p['section']) != norm(p['municipality']) else None
        places.append(p)

    out_sql = Path('migrations/0003_places.sql')
    q = lambda s: "'" + s.replace("'", "''") + "'"
    lines = [
        '-- Migration number: 0003',
        '-- Generated by scripts/build_places.py from GeoNames (CC BY 4.0). Do not edit by hand; regenerate instead.',
        f'-- {len(places)} places: ' + ', '.join(f"{k} {sum(p['kind'] == k for p in places)}" for k in KIND_ORDER),
        '',
    ]
    for i in range(0, len(places), 250):
        chunk = places[i:i + 250]
        lines.append('INSERT OR IGNORE INTO places (id, name, search_name, aliases, kind, municipality, province, lat, lng, geonames_id) VALUES')
        lines.append(',\n'.join(
            f"  ({q(p['id'])}, {q(p['name'])}, {q(norm(p['name']))}, {q(json.dumps(p['aliases'], ensure_ascii=False))}, "
            f"{q(p['kind'])}, {q(p['municipality'])}, {q(p['province'])}, {p['lat']}, {p['lng']}, {p['geonames_id']})"
            for p in chunk) + ';')
    out_sql.write_text('\n'.join(lines) + '\n', encoding='utf-8')

    # Compact Worker copy: municipalities and provinces are referenced by index to keep the bundle small.
    prov_list = sorted({p['province'] for p in places})
    muni_list = sorted({(p['municipality'], p['province']) for p in places})
    muni_idx = {m: i for i, m in enumerate(muni_list)}
    kinds = list(KIND_ORDER)
    data = {
        'attribution': 'GeoNames (geonames.org), CC BY 4.0',
        'kinds': kinds,
        'provinces': prov_list,
        'municipalities': [[m, prov_list.index(pr)] for m, pr in muni_list],
        # [id, name, kind index, municipality index, lat, lng, hint or "", aliases]
        'places': [[p['id'], p['name'], kinds.index(p['kind']), muni_idx[(p['municipality'], p['province'])],
                    p['lat'], p['lng'], p['hint'] or '', p['aliases']] for p in places],
    }
    out_json = Path('src/places/data.json')
    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_json.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'{len(places)} places → {out_sql} ({out_sql.stat().st_size // 1024} KB), {out_json} ({out_json.stat().st_size // 1024} KB)')


if __name__ == '__main__':
    main(sys.argv[1])
