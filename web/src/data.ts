// Sample data for the design mockup. Every dog and shelter here is fictional.
// The shapes mirror what the API (Cloudflare Workers + D1) will return.

export type Size = 'pequeno' | 'mediano' | 'grande';
export type Sex = 'hembra' | 'macho';
export type Energy = 'tranquila' | 'media' | 'alta';
export type AgeGroup = 'cachorro' | 'joven' | 'adulto' | 'mayor';
export type Companion = 'ninos' | 'perros' | 'gatos';
export type FrameColor = 'hoja' | 'mango' | 'anil' | 'turquesa';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Shelter {
  id: string;
  name: string;
  sector: string;
  city: string;
  location: LatLng;
  visitHours: string;
}

export interface Dog {
  id: string;
  name: string;
  sex: Sex;
  ageMonths: number;
  size: Size;
  energy: Energy;
  shelterId: string;
  photo: string;
  /** CSS object-position so the dog's face stays in frame at any aspect. */
  focus: string;
  frame: FrameColor;
  goodWith: Record<Companion, boolean | null>;
  health: { vacunas: boolean; esterilizacion: boolean; desparasitacion: boolean };
  story: string;
  needs: string[];
  arrived: string;
}

export const userLocation: { label: string; city: string; point: LatLng } = {
  label: 'Gazcue',
  city: 'Santo Domingo',
  point: { lat: 18.4655, lng: -69.9128 },
};

export const shelters: Shelter[] = [
  {
    id: 'patitas-gazcue',
    name: 'Patitas de Gazcue',
    sector: 'Gazcue',
    city: 'Santo Domingo',
    location: { lat: 18.468, lng: -69.918 },
    visitHours: 'Sáb. y dom., 9:00 a. m. – 1:00 p. m.',
  },
  {
    id: 'hogar-los-mina',
    name: 'Hogar Canino Los Mina',
    sector: 'Los Mina',
    city: 'Santo Domingo Este',
    location: { lat: 18.495, lng: -69.856 },
    visitHours: 'Lun. a vie., 3:00 – 6:00 p. m.',
  },
  {
    id: 'huellas-alcarrizos',
    name: 'Huellas de Los Alcarrizos',
    sector: 'Los Alcarrizos',
    city: 'Santo Domingo Oeste',
    location: { lat: 18.518, lng: -70.017 },
    visitHours: 'Sábados, 8:00 a. m. – 12:00 m.',
  },
  {
    id: 'rescate-san-cristobal',
    name: 'Rescate San Cristóbal',
    sector: 'Madre Vieja',
    city: 'San Cristóbal',
    location: { lat: 18.416, lng: -70.106 },
    visitHours: 'Con cita previa',
  },
  {
    id: 'rescate-boca-chica',
    name: 'Amigos de Boca Chica',
    sector: 'Andrés',
    city: 'Boca Chica',
    location: { lat: 18.451, lng: -69.606 },
    visitHours: 'Dom., 10:00 a. m. – 2:00 p. m.',
  },
  {
    id: 'amigos-santiago',
    name: 'Refugio Cibao',
    sector: 'Los Jardines',
    city: 'Santiago',
    location: { lat: 19.451, lng: -70.697 },
    visitHours: 'Mar. a sáb., 9:00 a. m. – 4:00 p. m.',
  },
];

export const dogs: Dog[] = [
  {
    id: 'canela',
    name: 'Canela',
    sex: 'hembra',
    ageMonths: 48,
    size: 'mediano',
    energy: 'media',
    shelterId: 'patitas-gazcue',
    photo: '/perros/canela.jpg',
    focus: '50% 40%',
    frame: 'hoja',
    goodWith: { ninos: true, perros: true, gatos: null },
    health: { vacunas: true, esterilizacion: true, desparasitacion: true },
    story:
      'La encontraron durmiendo debajo de una guagua en la avenida Bolívar. Es tranquila en casa y le encanta ir de paseo por el Malecón temprano, antes del calor. Saluda a todo el mundo con la cola.',
    needs: ['Dos paseos al día', 'Un rincón fresco para la siesta'],
    arrived: '2026-07-02',
  },
  {
    id: 'pinto',
    name: 'Pinto',
    sex: 'macho',
    ageMonths: 30,
    size: 'mediano',
    energy: 'alta',
    shelterId: 'hogar-los-mina',
    photo: '/perros/pinto.jpg',
    focus: '50% 35%',
    frame: 'anil',
    goodWith: { ninos: true, perros: true, gatos: false },
    health: { vacunas: true, esterilizacion: true, desparasitacion: true },
    story:
      'Pinto vivía en un colmado de Los Mina y todos los del barrio lo conocían. Es puro movimiento: corre, juega con la pelota y aprende rápido. Necesita una familia activa que lo saque a correr.',
    needs: ['Ejercicio diario', 'Casa sin gatos', 'Patio o paseos largos'],
    arrived: '2026-08-15',
  },
  {
    id: 'morena',
    name: 'Morena',
    sex: 'hembra',
    ageMonths: 84,
    size: 'pequeno',
    energy: 'tranquila',
    shelterId: 'patitas-gazcue',
    photo: '/perros/morena.jpg',
    focus: '50% 30%',
    frame: 'mango',
    goodWith: { ninos: true, perros: false, gatos: true },
    health: { vacunas: true, esterilizacion: true, desparasitacion: true },
    story:
      'Morena tiene siete años y la mirada más dulce del refugio. Su familia se mudó fuera del país y no pudo llevarla. Le gusta el sofá, los cariños en las orejas y la rutina.',
    needs: ['Hogar tranquilo', 'Ser la única perra de la casa'],
    arrived: '2026-05-20',
  },
  {
    id: 'bizcocho',
    name: 'Bizcocho',
    sex: 'macho',
    ageMonths: 22,
    size: 'mediano',
    energy: 'media',
    shelterId: 'huellas-alcarrizos',
    photo: '/perros/bizcocho.jpg',
    focus: '50% 30%',
    frame: 'turquesa',
    goodWith: { ninos: true, perros: true, gatos: true },
    health: { vacunas: true, esterilizacion: false, desparasitacion: true },
    story:
      'Bizcocho es el que recibe a los voluntarios en la puerta. Se lleva bien con todos, perros y gatos incluidos. Ya sabe sentarse y dar la pata; le falta aprender a no robarse las chancletas.',
    needs: ['Esterilización programada en noviembre'],
    arrived: '2026-09-01',
  },
  {
    id: 'cacao',
    name: 'Cacao',
    sex: 'macho',
    ageMonths: 96,
    size: 'grande',
    energy: 'tranquila',
    shelterId: 'rescate-san-cristobal',
    photo: '/perros/cacao.jpg',
    focus: '45% 40%',
    frame: 'mango',
    goodWith: { ninos: true, perros: true, gatos: null },
    health: { vacunas: true, esterilizacion: true, desparasitacion: true },
    story:
      'Cacao tiene ocho años y un corazón enorme. Es grande pero se mueve despacio; prefiere echarse a tu lado que correr. Los perros mayores esperan más tiempo por un hogar.',
    needs: ['Espacio para un perro grande', 'Chequeo de articulaciones cada seis meses'],
    arrived: '2026-02-11',
  },
  {
    id: 'chispa',
    name: 'Chispa',
    sex: 'hembra',
    ageMonths: 14,
    size: 'pequeno',
    energy: 'alta',
    shelterId: 'hogar-los-mina',
    photo: '/perros/chispa.jpg',
    focus: '50% 35%',
    frame: 'hoja',
    goodWith: { ninos: true, perros: true, gatos: false },
    health: { vacunas: true, esterilizacion: true, desparasitacion: true },
    story:
      'Chispa hace honor a su nombre. Es pequeña, curiosa y siempre está atenta a lo que pasa. Le encanta que le enseñen trucos a cambio de un premio.',
    needs: ['Juego diario', 'Casa sin gatos'],
    arrived: '2026-08-28',
  },
  {
    id: 'toston',
    name: 'Tostón',
    sex: 'macho',
    ageMonths: 4,
    size: 'mediano',
    energy: 'alta',
    shelterId: 'rescate-san-cristobal',
    photo: '/perros/toston.jpg',
    focus: '55% 35%',
    frame: 'anil',
    goodWith: { ninos: true, perros: true, gatos: true },
    health: { vacunas: false, esterilizacion: false, desparasitacion: true },
    story:
      'Tostón llegó con sus hermanos en una caja de cartón. Es un cachorro: muerde todo, duerme mucho y necesita paciencia mientras aprende. Le faltan las últimas vacunas.',
    needs: ['Completar vacunas', 'Paciencia con el entrenamiento'],
    arrived: '2026-09-20',
  },
  {
    id: 'brisa',
    name: 'Brisa',
    sex: 'hembra',
    ageMonths: 36,
    size: 'mediano',
    energy: 'alta',
    shelterId: 'rescate-boca-chica',
    photo: '/perros/brisa.jpg',
    focus: '50% 45%',
    frame: 'turquesa',
    goodWith: { ninos: true, perros: true, gatos: null },
    health: { vacunas: true, esterilizacion: true, desparasitacion: true },
    story:
      'Brisa apareció en la playa de Boca Chica y los pescadores la cuidaron hasta que llegó al refugio. Ama el agua y correr por la arena. Es cariñosa y obediente.',
    needs: ['Paseos largos', 'Familia activa'],
    arrived: '2026-06-09',
  },
  {
    id: 'miel',
    name: 'Miel',
    sex: 'hembra',
    ageMonths: 26,
    size: 'mediano',
    energy: 'media',
    shelterId: 'huellas-alcarrizos',
    photo: '/perros/miel.jpg',
    focus: '50% 30%',
    frame: 'mango',
    goodWith: { ninos: true, perros: true, gatos: true },
    health: { vacunas: true, esterilizacion: true, desparasitacion: true },
    story:
      'Miel se tira panza arriba en la grama cada vez que puede. Es juguetona sin ser intensa, y duerme toda la noche. Ideal para una primera adopción.',
    needs: ['Cariño y rutina'],
    arrived: '2026-07-30',
  },
  {
    id: 'algodon',
    name: 'Algodón',
    sex: 'macho',
    ageMonths: 60,
    size: 'pequeno',
    energy: 'media',
    shelterId: 'amigos-santiago',
    photo: '/perros/algodon.jpg',
    focus: '50% 45%',
    frame: 'hoja',
    goodWith: { ninos: false, perros: true, gatos: true },
    health: { vacunas: true, esterilizacion: true, desparasitacion: true },
    story:
      'Algodón es un caballero: tranquilo, educado y un poco tímido al principio. Prefiere casas sin niños pequeños, donde pueda tomar confianza a su ritmo.',
    needs: ['Casa sin niños pequeños', 'Baño y corte cada mes'],
    arrived: '2026-04-18',
  },
];

export const shelterById = new Map(shelters.map((s) => [s.id, s]));
export const dogById = new Map(dogs.map((d) => [d.id, d]));

export function ageGroup(months: number): AgeGroup {
  if (months < 12) return 'cachorro';
  if (months < 36) return 'joven';
  if (months < 84) return 'adulto';
  return 'mayor';
}

/** Placeholder address for the multi-adoption CTA. Replace before launch. */
export const CONTACT_EMAIL = 'hola@patiamor.com';
