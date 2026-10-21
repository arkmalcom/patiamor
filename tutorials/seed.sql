-- Tutorial recordings only: applied after api/seeds/staging.sql to the recorder's own local database.
-- Everyone here is fictional, like the staging sample data (@ejemplo.do is never emailed).

-- People the videos sign in as, each at a different step:
--   Marta: a new account, not yet approved for anything (asks for shelter access, or to list privately).
--   Luis: approved as a shelter owner, with no shelter registered yet.
INSERT OR IGNORE INTO users (id, email, name, shelter_owner_at) VALUES
  ('tutorial-marta', 'marta.jimenez@ejemplo.do', 'Marta Jiménez', NULL),
  ('tutorial-luis',  'luis.feliz@ejemplo.do',    'Luis Féliz',    '2026-10-18T14:00:00Z');

-- Sessions for those people and for the sample owner Carla Méndez (Patitas de Gazcue). Each cookie value is
-- 'tutorial-session-<name>' (record.ts); these hashes are their SHA-256.
INSERT OR REPLACE INTO sessions (id_hash, user_id, expires_at) VALUES
  ('103c22e6193972e2f2a2653292f2571ab9e2115ad78c6551d6911942b266d35c', 'seed-vol-gazcue', strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '+1 day')),
  ('96729bd740938c107da5da1a8c454530f033158b1f7b55f2946986274933c894', 'tutorial-marta',  strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '+1 day')),
  ('62d8fc740418efbd0c393f5fb0a43ccf41c996c0b96aae89674070ecf4075ae2', 'tutorial-luis',   strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '+1 day'));

-- Families who asked for Patitas de Gazcue's animals, for the inbox and "Se fue a casa" videos.
INSERT OR IGNORE INTO users (id, email, name) VALUES
  ('tutorial-laura',  'laura.gomez@ejemplo.do',   'Laura Gómez'),
  ('tutorial-miguel', 'miguel.santana@ejemplo.do', 'Miguel Santana'),
  ('tutorial-paola',  'paola.reyes@ejemplo.do',   'Paola Reyes');

INSERT OR IGNORE INTO adoption_requests (id, pet_id, user_id, status, answer_space, answer_time, answer_cost, home, other_pets, kids, experience, visit,
  message, contact_name, contact_email, contact_phone, contact_pref, consent_at, distance_km, created_at, seen_at) VALUES
  ('tutorial-req-laura', 'canela', 'tutorial-laura', 'sent', 'si', 'si', 'si', 'casa_patio', '["perros"]', 'mayores', 'si', 'fin',
   'Vivimos en Los Prados y tenemos un perro tranquilo de 5 años. Trabajo desde casa, así que Canela tendría compañía todo el día.',
   'Laura Gómez', 'laura.gomez@ejemplo.do', '+18095550123', 'whatsapp', strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-3 hours'), 5,
   strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-3 hours'), NULL),
  ('tutorial-req-miguel', 'canela', 'tutorial-miguel', 'sent', 'si', 'pensando', 'si', 'apartamento', '[]', 'no', 'primera', 'semana',
   NULL, 'Miguel Santana', 'miguel.santana@ejemplo.do', '+18295550145', 'llamada', strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-1 day'), 10,
   strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-1 day'), NULL),
  ('tutorial-req-paola', 'morena', 'tutorial-paola', 'contacted', 'si', 'si', 'si', 'casa', '[]', 'no', 'si', 'cualquiera',
   'Busco una compañera tranquila. Vivo sola y paso las tardes en casa.',
   'Paola Reyes', 'paola.reyes@ejemplo.do', '+18495550167', 'correo', strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-4 days'), 5,
   strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-4 days'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-3 days'));
