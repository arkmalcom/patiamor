-- Staging-only sample data. NEVER apply to production (production data comes from real shelters).
-- Every person and shelter here is fictional (emails use the reserved-for-examples style ejemplo.do).
-- Idempotent: INSERT OR IGNORE, so re-running only fills gaps. Apply with:
--   .claude/skills/cloudflare/scripts/cf d1 execute DB --env staging --remote --file seeds/staging.sql

-- Places used by the sample shelters (the full GeoNames places seed will use the same id convention).
INSERT OR IGNORE INTO places (id, name, search_name, aliases, kind, municipality, province, lat, lng) VALUES
  ('gazcue-distrito-nacional',      'Gazcue',         'gazcue',         '[]',            'barrio',            'Santo Domingo de Guzmán', 'Distrito Nacional', 18.4681, -69.9026),
  ('los-mina-sur-santo-domingo',    'Los Mina Sur',   'los mina sur',   '["los mina"]',  'barrio',            'Santo Domingo Este',      'Santo Domingo',     18.5036, -69.8674),
  ('los-alcarrizos-santo-domingo',  'Los Alcarrizos', 'los alcarrizos', '[]',            'municipio',         'Los Alcarrizos',          'Santo Domingo',     18.5180, -70.0170),
  ('madre-vieja-san-cristobal',     'Madre Vieja',    'madre vieja',    '[]',            'sector',            'San Cristóbal',           'San Cristóbal',     18.4160, -70.1060),
  ('andres-santo-domingo',          'Andrés',         'andres',         '["boca chica"]','sector',            'Boca Chica',              'Santo Domingo',     18.4510, -69.6060),
  ('los-jardines-santiago',         'Los Jardines',   'los jardines',   '[]',            'sector',            'Santiago de los Caballeros', 'Santiago',       19.4510, -70.6970),
  ('ensanche-naco-distrito-nacional','Ensanche Naco', 'ensanche naco',  '["naco"]',      'barrio',            'Santo Domingo de Guzmán', 'Distrito Nacional', 18.4753, -69.9266);

-- People. Real admin emails are not committed: CI promotes the STAGING_ADMIN_EMAILS secret after seeding.
INSERT OR IGNORE INTO users (id, email, name, is_admin, lister_approved_at) VALUES
  ('seed-vol-gazcue',      'voluntarios.gazcue@ejemplo.do',    'Carla Méndez',    0, NULL),
  ('seed-vol-losmina',     'hogar.losmina@ejemplo.do',         'José Rosario',    0, NULL),
  ('seed-vol-alcarrizos',  'huellas.alcarrizos@ejemplo.do',    'Yokasta Peña',    0, NULL),
  ('seed-vol-sancristobal','rescate.sancristobal@ejemplo.do',  'Ramón Castillo',  0, NULL),
  ('seed-vol-bocachica',   'amigos.bocachica@ejemplo.do',      'Leidy Batista',   0, NULL),
  ('seed-vol-santiago',    'refugio.cibao@ejemplo.do',         'Andrés Tavárez',  0, NULL),
  ('seed-private-approved','familia.reyes@ejemplo.do',         'Familia Reyes',   0, '2026-10-01T15:00:00Z'),
  ('seed-private-new',     'nuevo.dueno@ejemplo.do',           'Pedro Almonte',   0, NULL),
  ('seed-private-gatos',   'rosa.hernandez@ejemplo.do',        'Rosa Hernández',  0, '2026-09-20T14:00:00Z'),
  ('seed-adopter',         'ana.adoptante@ejemplo.do',         'Ana Pérez',       0, NULL);

-- Shelters. Five verified; Refugio Cibao is deliberately unverified so the review path can be tested.
INSERT OR IGNORE INTO shelters (id, slug, name, description, place_id, phone, visit_hours, verified_at) VALUES
  ('seed-patitas-gazcue',      'patitas-de-gazcue',       'Patitas de Gazcue',         'Refugio pequeño de voluntarios en Gazcue.',        'gazcue-distrito-nacional',     '809-555-0101', 'Sáb. y dom., 9:00 a. m. – 1:00 p. m.',  '2026-09-01T12:00:00Z'),
  ('seed-hogar-los-mina',      'hogar-canino-los-mina',   'Hogar Canino Los Mina',     'Rescates del barrio, con hogares temporales.',     'los-mina-sur-santo-domingo',   '809-555-0102', 'Lun. a vie., 3:00 – 6:00 p. m.',         '2026-09-01T12:00:00Z'),
  ('seed-huellas-alcarrizos',  'huellas-de-los-alcarrizos','Huellas de Los Alcarrizos', 'Rescate y esterilización en Santo Domingo Oeste.', 'los-alcarrizos-santo-domingo', '809-555-0103', 'Sábados, 8:00 a. m. – 12:00 m.',         '2026-09-02T12:00:00Z'),
  ('seed-rescate-sancristobal','rescate-san-cristobal',   'Rescate San Cristóbal',     'Perros mayores y casos médicos.',                  'madre-vieja-san-cristobal',    '809-555-0104', 'Con cita previa',                         '2026-09-03T12:00:00Z'),
  ('seed-amigos-bocachica',    'amigos-de-boca-chica',    'Amigos de Boca Chica',      'Perros rescatados de la playa y la costa.',        'andres-santo-domingo',         '809-555-0105', 'Dom., 10:00 a. m. – 2:00 p. m.',         '2026-09-04T12:00:00Z'),
  ('seed-refugio-cibao',       'refugio-cibao',           'Refugio Cibao',             'Refugio nuevo en Santiago (pendiente de verificar).','los-jardines-santiago',       '809-555-0106', 'Mar. a sáb., 9:00 a. m. – 4:00 p. m.',   NULL);

INSERT OR IGNORE INTO shelter_members (shelter_id, user_id, role) VALUES
  ('seed-patitas-gazcue',       'seed-vol-gazcue',       'owner'),
  ('seed-hogar-los-mina',       'seed-vol-losmina',      'owner'),
  ('seed-huellas-alcarrizos',   'seed-vol-alcarrizos',   'owner'),
  ('seed-rescate-sancristobal', 'seed-vol-sancristobal', 'owner'),
  ('seed-amigos-bocachica',     'seed-vol-bocachica',    'owner'),
  ('seed-refugio-cibao',        'seed-vol-santiago',     'owner');

-- A private litter (Familia Reyes, already approved as a lister).
INSERT OR IGNORE INTO litters (id, listed_by, shelter_id, place_id, name, born_on, notes) VALUES
  ('seed-litter-luna', 'seed-private-approved', NULL, 'ensanche-naco-distrito-nacional', 'Camada de Luna', '2026-08-01', 'La madre, Luna, vive con la familia y será esterilizada en noviembre.');

INSERT OR IGNORE INTO pets (id, listed_by, shelter_id, place_id, litter_id, name, sex, birth_date, birth_date_estimated, size, energy,
  good_with_kids, good_with_dogs, good_with_cats, vaccinated, sterilized, dewormed, story, needs, adoption_fee_dop, status, in_care_since, published_at) VALUES
  ('canela',   'seed-vol-gazcue',       'seed-patitas-gazcue',       'gazcue-distrito-nacional',     NULL, 'Canela',   'hembra', '2022-10-12', 1, 'mediano', 'media',     1, 1, NULL, 1, 1, 1,
   'La encontraron durmiendo debajo de una guagua en la avenida Bolívar. Es tranquila en casa y le encanta ir de paseo por el Malecón temprano, antes del calor. Saluda a todo el mundo con la cola.',
   '["Dos paseos al día","Un rincón fresco para la siesta"]', 1500, 'available', '2026-07-02', '2026-07-05T12:00:00Z'),
  ('pinto',    'seed-vol-losmina',      'seed-hogar-los-mina',       'los-mina-sur-santo-domingo',   NULL, 'Pinto',    'macho',  '2024-04-12', 1, 'mediano', 'alta',      1, 1, 0,    1, 1, 1,
   'Pinto vivía en un colmado de Los Mina y todos los del barrio lo conocían. Es puro movimiento: corre, juega con la pelota y aprende rápido. Necesita una familia activa que lo saque a correr.',
   '["Ejercicio diario","Casa sin gatos","Patio o paseos largos"]', NULL, 'available', '2026-08-15', '2026-08-16T12:00:00Z'),
  ('morena',   'seed-vol-gazcue',       'seed-patitas-gazcue',       'gazcue-distrito-nacional',     NULL, 'Morena',   'hembra', '2019-10-12', 1, 'pequeno', 'tranquila', 1, 0, 1,    1, 1, 1,
   'Morena tiene siete años y la mirada más dulce del refugio. Su familia se mudó fuera del país y no pudo llevarla. Le gusta el sofá, los cariños en las orejas y la rutina.',
   '["Hogar tranquilo","Ser la única perra de la casa"]', 1000, 'available', '2026-05-20', '2026-05-22T12:00:00Z'),
  ('bizcocho', 'seed-vol-alcarrizos',   'seed-huellas-alcarrizos',   'los-alcarrizos-santo-domingo', NULL, 'Bizcocho', 'macho',  '2024-12-12', 1, 'mediano', 'media',     1, 1, 1,    1, 0, 1,
   'Bizcocho es el que recibe a los voluntarios en la puerta. Se lleva bien con todos, perros y gatos incluidos. Ya sabe sentarse y dar la pata; le falta aprender a no robarse las chancletas.',
   '["Esterilización programada en noviembre"]', NULL, 'available', '2026-09-01', '2026-09-03T12:00:00Z'),
  ('cacao',    'seed-vol-sancristobal', 'seed-rescate-sancristobal', 'madre-vieja-san-cristobal',    NULL, 'Cacao',    'macho',  '2018-10-12', 1, 'grande',  'tranquila', 1, 1, NULL, 1, 1, 1,
   'Cacao tiene ocho años y un corazón enorme. Es grande pero se mueve despacio; prefiere echarse a tu lado que correr. Los perros mayores esperan más tiempo por un hogar.',
   '["Espacio para un perro grande","Chequeo de articulaciones cada seis meses"]', NULL, 'available', '2026-02-11', '2026-02-14T12:00:00Z'),
  ('chispa',   'seed-vol-losmina',      'seed-hogar-los-mina',       'los-mina-sur-santo-domingo',   NULL, 'Chispa',   'hembra', '2025-08-12', 1, 'pequeno', 'alta',      1, 1, 0,    1, 1, 1,
   'Chispa hace honor a su nombre. Es pequeña, curiosa y siempre está atenta a lo que pasa. Le encanta que le enseñen trucos a cambio de un premio.',
   '["Juego diario","Casa sin gatos"]', NULL, 'available', '2026-08-28', '2026-08-30T12:00:00Z'),
  ('toston',   'seed-vol-sancristobal', 'seed-rescate-sancristobal', 'madre-vieja-san-cristobal',    NULL, 'Tostón',   'macho',  '2026-06-12', 1, 'mediano', 'alta',      1, 1, 1,    0, 0, 1,
   'Tostón llegó con sus hermanos en una caja de cartón. Es un cachorro: muerde todo, duerme mucho y necesita paciencia mientras aprende. Le faltan las últimas vacunas.',
   '["Completar vacunas","Paciencia con el entrenamiento"]', 800, 'available', '2026-09-20', '2026-09-22T12:00:00Z'),
  ('brisa',    'seed-vol-bocachica',    'seed-amigos-bocachica',     'andres-santo-domingo',         NULL, 'Brisa',    'hembra', '2023-10-12', 1, 'mediano', 'alta',      1, 1, NULL, 1, 1, 1,
   'Brisa apareció en la playa de Boca Chica y los pescadores la cuidaron hasta que llegó al refugio. Ama el agua y correr por la arena. Es cariñosa y obediente.',
   '["Paseos largos","Familia activa"]', NULL, 'available', '2026-06-09', '2026-06-11T12:00:00Z'),
  ('miel',     'seed-vol-alcarrizos',   'seed-huellas-alcarrizos',   'los-alcarrizos-santo-domingo', NULL, 'Miel',     'hembra', '2024-08-12', 1, 'mediano', 'media',     1, 1, 1,    1, 1, 1,
   'Miel se tira panza arriba en la grama cada vez que puede. Es juguetona sin ser intensa, y duerme toda la noche. Ideal para una primera adopción.',
   '["Cariño y rutina"]', NULL, 'available', '2026-07-30', '2026-08-01T12:00:00Z'),
  -- Unverified shelter: its dog waits in review and must not appear in search.
  ('algodon',  'seed-vol-santiago',     'seed-refugio-cibao',        'los-jardines-santiago',        NULL, 'Algodón',  'macho',  '2021-10-12', 1, 'pequeno', 'media',     0, 1, 1,    1, 1, 1,
   'Algodón es un caballero: tranquilo, educado y un poco tímido al principio. Prefiere casas sin niños pequeños, donde pueda tomar confianza a su ritmo.',
   '["Casa sin niños pequeños","Baño y corte cada mes"]', NULL, 'in_review', '2026-04-18', NULL),
  -- Private litter (approved lister): shows as "Particular".
  ('yuca',     'seed-private-approved', NULL, 'ensanche-naco-distrito-nacional', 'seed-litter-luna', 'Yuca',    'hembra', '2026-08-01', 0, 'mediano', 'alta', 1, 1, NULL, 1, 0, 1,
   'Yuca es la más tranquila de la camada de Luna. Ya come sola y duerme en su camita.', '["Completar vacunas","Esterilización cuando tenga edad"]', NULL, 'available', '2026-08-01', '2026-10-05T12:00:00Z'),
  ('platano',  'seed-private-approved', NULL, 'ensanche-naco-distrito-nacional', 'seed-litter-luna', 'Plátano', 'macho',  '2026-08-01', 0, 'mediano', 'alta', 1, 1, NULL, 1, 0, 1,
   'Plátano es el aventurero de la camada: siempre el primero en salir a explorar el patio.', '["Completar vacunas","Esterilización cuando tenga edad"]', NULL, 'available', '2026-08-01', '2026-10-05T12:00:00Z'),
  -- First listing from a new private lister: waits for admin approval.
  ('rocky',    'seed-private-new',      NULL, 'gazcue-distrito-nacional', NULL, 'Rocky', 'macho', '2023-03-01', 1, 'grande', 'media', 1, 0, NULL, 1, 1, 1,
   'Me mudo a un apartamento donde no permiten perros grandes y busco una familia con patio para Rocky.', '["Patio","Ser el único perro"]', NULL, 'in_review', NULL, NULL);

-- Photos: sample images ship with the web app under /perros/ and /gatos/, so keys here point at those static files.
INSERT OR IGNORE INTO pet_photos (id, pet_id, r2_key, position, focus) VALUES
  ('seed-photo-canela',   'canela',   'static:/perros/canela.jpg',   0, '50% 40%'),
  ('seed-photo-pinto',    'pinto',    'static:/perros/pinto.jpg',    0, '78% 40%'),
  ('seed-photo-morena',   'morena',   'static:/perros/morena.jpg',   0, '50% 30%'),
  ('seed-photo-bizcocho', 'bizcocho', 'static:/perros/bizcocho.jpg', 0, '50% 30%'),
  ('seed-photo-cacao',    'cacao',    'static:/perros/cacao.jpg',    0, '45% 40%'),
  ('seed-photo-chispa',   'chispa',   'static:/perros/chispa.jpg',   0, '50% 35%'),
  ('seed-photo-toston',   'toston',   'static:/perros/toston.jpg',   0, '55% 35%'),
  ('seed-photo-brisa',    'brisa',    'static:/perros/brisa.jpg',    0, '50% 45%'),
  ('seed-photo-miel',     'miel',     'static:/perros/miel.jpg',     0, '50% 30%'),
  ('seed-photo-algodon',  'algodon',  'static:/perros/algodon.jpg',  0, '50% 45%');

-- ---------- Cats ----------
INSERT OR IGNORE INTO litters (id, listed_by, shelter_id, place_id, name, born_on, notes) VALUES
  ('seed-litter-mota', 'seed-private-gatos', NULL, 'los-mina-norte-santo-domingo', 'Camada de Mota', '2026-07-20', 'Mota llegó embarazada al patio; ya está esterilizada.');

INSERT OR IGNORE INTO pets (id, species, listed_by, shelter_id, place_id, litter_id, name, sex, birth_date, birth_date_estimated, size, energy,
  good_with_kids, good_with_dogs, good_with_cats, vaccinated, sterilized, dewormed, story, needs, adoption_fee_dop, status, in_care_since, published_at) VALUES
  ('domino',    'gato', 'seed-vol-gazcue',       'seed-patitas-gazcue',       'gazcue-distrito-nacional',     NULL, 'Dominó',    'macho',  '2024-09-13', 1, 'mediano', 'media',     1, 0, 1, 1, 1, 1,
   'Lo encontraron dentro de una caja de dominó en un colmado de Gazcue, y de ahí el nombre. Es curioso, conversador y se acomoda en cualquier rodilla disponible.',
   '["Ventanas con malla","Rascador"]', 800, 'available', '2026-06-15', '2026-06-18T12:00:00Z'),
  ('tamarindo', 'gato', 'seed-vol-alcarrizos',   'seed-huellas-alcarrizos',   'los-alcarrizos-santo-domingo', NULL, 'Tamarindo', 'macho',  '2021-10-13', 1, 'mediano', 'tranquila', 1, 1, 1, 1, 1, 1,
   'Tamarindo tiene cinco años y una sola meta en la vida: encontrar el rayito de sol de la tarde. Convive con perros sin problema.',
   '["Un lugar soleado","Comida para gatos adultos"]', NULL, 'available', '2026-05-02', '2026-05-04T12:00:00Z'),
  ('cafe',      'gato', 'seed-vol-bocachica',    'seed-amigos-bocachica',     'andres-santo-domingo',         NULL, 'Café',      'hembra', '2023-10-13', 1, 'mediano', 'media',     1, NULL, 0, 1, 1, 1,
   'Café es independiente pero cariñosa a su manera: te sigue de cuarto en cuarto sin pedir nada. Prefiere ser la única gata de la casa.',
   '["Ser la única gata","Rutina tranquila"]', NULL, 'available', '2026-07-10', '2026-07-12T12:00:00Z'),
  ('batata',    'gato', 'seed-vol-sancristobal', 'seed-rescate-sancristobal', 'madre-vieja-san-cristobal',    NULL, 'Batata',    'macho',  '2025-10-13', 1, 'mediano', 'alta',      1, 1, 1, 1, 1, 1,
   'Batata es puro movimiento: persigue todo lo que se mueve y luego cae rendido en el lugar menos pensado.',
   '["Juego diario","Juguetes y rascador"]', 500, 'available', '2026-08-20', '2026-08-22T12:00:00Z'),
  ('ceniza',    'gato', 'seed-vol-gazcue',       'seed-patitas-gazcue',       'gazcue-distrito-nacional',     NULL, 'Ceniza',    'hembra', '2018-10-13', 1, 'mediano', 'tranquila', 1, NULL, 1, 1, 1, 1,
   'Ceniza tiene ocho años. Su dueña falleció y la familia no podía quedarse con ella. Es serena, limpia y agradecida; los gatos mayores son los que más esperan.',
   '["Hogar tranquilo","Chequeo veterinario anual"]', NULL, 'available', '2026-04-01', '2026-04-03T12:00:00Z'),
  -- Private kitten litter (approved lister): shows as "Particular".
  ('chinola',   'gato', 'seed-private-gatos', NULL, 'los-mina-norte-santo-domingo', 'seed-litter-mota', 'Chinola',  'hembra', '2026-07-20', 0, 'pequeno', 'alta', 1, NULL, 1, 1, 0, 1,
   'Chinola es la exploradora de la camada de Mota: siempre la primera en subirse a todo.', '["Completar vacunas","Esterilización cuando tenga edad"]', NULL, 'available', '2026-07-20', '2026-10-01T12:00:00Z'),
  ('guayaba',   'gato', 'seed-private-gatos', NULL, 'los-mina-norte-santo-domingo', 'seed-litter-mota', 'Guayaba',  'macho',  '2026-07-20', 0, 'pequeno', 'alta', 1, NULL, 1, 1, 0, 1,
   'Guayaba ronronea apenas lo cargas. Le encantan los cordones y las cajas vacías.', '["Completar vacunas","Esterilización cuando tenga edad"]', NULL, 'available', '2026-07-20', '2026-10-01T12:00:00Z'),
  -- Too young to list (under 8 weeks): must stay hidden from search even though it's "available".
  ('mini',      'gato', 'seed-private-gatos', NULL, 'los-mina-norte-santo-domingo', 'seed-litter-mota', 'Mini',     'hembra', '2026-09-10', 0, 'pequeno', 'media', NULL, NULL, NULL, 0, 0, 0,
   'La más pequeña de la camada.', '[]', NULL, 'available', '2026-09-10', '2026-10-01T12:00:00Z');

INSERT OR IGNORE INTO pet_photos (id, pet_id, r2_key, position, focus) VALUES
  ('seed-photo-domino',    'domino',    'static:/gatos/domino.jpg',    0, '50% 35%'),
  ('seed-photo-tamarindo', 'tamarindo', 'static:/gatos/tamarindo.jpg', 0, '55% 50%'),
  ('seed-photo-cafe',      'cafe',      'static:/gatos/cafe.jpg',      0, '45% 45%'),
  ('seed-photo-batata',    'batata',    'static:/gatos/batata.jpg',    0, '40% 45%'),
  ('seed-photo-ceniza',    'ceniza',    'static:/gatos/ceniza.jpg',    0, '50% 40%'),
  ('seed-photo-chinola',   'chinola',   'static:/gatos/chinola.jpg',   0, '50% 40%'),
  ('seed-photo-guayaba',   'guayaba',   'static:/gatos/guayaba.jpg',   0, '50% 35%');

-- Corrections to rows earlier seeds already inserted (INSERT OR IGNORE won't touch them).
UPDATE pet_photos SET focus = '78% 40%' WHERE id = 'seed-photo-pinto';
-- Shelters seeded as verified (verified_at set) get the matching status (migration 0009 added it).
UPDATE shelters SET status = 'verified' WHERE verified_at IS NOT NULL AND status = 'pending';
