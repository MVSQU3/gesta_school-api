/**
 * Jeu de données de référence du seed : patronymes ivoiriens, matières,
 * classes et barèmes. Isolé du script pour que `seed.ts` reste lisible.
 */

export const LAST_NAMES = [
  'Kouassi',
  'Koné',
  'Traoré',
  'Yao',
  'N’Guessan',
  'Diabaté',
  'Ouattara',
  'Bamba',
  'Coulibaly',
  'Kouadio',
  'Aka',
  'Brou',
  'Touré',
  'Kacou',
  'Doumbia',
  'Gnahoré',
  'Zadi',
  'Adjoua',
  'Beugré',
  'Séri',
  'Tanoh',
  'Djédjé',
  'Amani',
  'Konaté',
  'Sangaré',
  'Fofana',
  'Cissé',
  'Dosso',
  'Guéi',
  'Loba',
  'Assamoi',
  'Kanga',
  'Ehui',
  'Tapé',
  'Gbagbo',
  'Silué',
  'Soro',
  'Yapi',
  'Kobenan',
  'Anoh',
  'Boni',
  'Digbeu',
  'Ettien',
  'Kouamé',
  'Mensah',
  'Ndri',
  'Oulaï',
  'Piépié',
  'Sidibé',
  'Vanié',
];

export const MALE_FIRST_NAMES = [
  'Kouadio',
  'Ibrahim',
  'Serge',
  'Yannick',
  'Aboubacar',
  'Franck',
  'Ismaël',
  'Arsène',
  'Cédric',
  'Moussa',
  'Landry',
  'Éric',
  'Olivier',
  'Christian',
  'Karim',
  'Jean-Marc',
  'Prince',
  'Abdoulaye',
  'Régis',
  'Wilfried',
  'Ange',
  'Souleymane',
  'Émmanuel',
  'Bakary',
  'Hervé',
  'Marcelin',
  'Junior',
];

export const FEMALE_FIRST_NAMES = [
  'Aya',
  'Mariam',
  'Adjoua',
  'Fatoumata',
  'Estelle',
  'Nadège',
  'Aminata',
  'Rebecca',
  'Grâce',
  'Awa',
  'Léa',
  'Sylvie',
  'Chantal',
  'Prisca',
  'Bintou',
  'Danielle',
  'Salimata',
  'Ruth',
  'Carine',
  'Djeneba',
  'Épiphanie',
  'Kadidja',
  'Marie-Louise',
  'Affoué',
  'Rachelle',
  'Solange',
  'Nafissatou',
];

export const TEACHER_FIRST_NAMES = [
  'Abou',
  'Célestin',
  'Diomandé',
  'Étienne',
  'Félicité',
  'Georges',
  'Honorine',
  'Ismaël',
  'Justine',
  'Koffi',
  'Lucien',
  'Mathurin',
  'Noëlle',
  'Odette',
  'Patrice',
  'Quentin',
  'Raoul',
  'Séverin',
  'Thérèse',
  'Urbain',
  'Valentin',
];

/** Matière : nom, abréviation bulletin, coefficient par filière. */
export interface SubjectSpec {
  name: string;
  shortName: string;
  /** Coefficient par défaut (collège, ou série littéraire au lycée). */
  coefficient: number;
  /** Coefficient en série scientifique (classes « C »). Défaut = coefficient. */
  coefficientC?: number;
}

export const COLLEGE_SUBJECTS: SubjectSpec[] = [
  { name: 'Français', shortName: 'FRA', coefficient: 4 },
  { name: 'Mathématiques', shortName: 'MATH', coefficient: 4 },
  { name: 'Anglais', shortName: 'ANG', coefficient: 3 },
  { name: 'Histoire-Géographie', shortName: 'HG', coefficient: 2 },
  {
    name: 'Sciences de la Vie et de la Terre',
    shortName: 'SVT',
    coefficient: 2,
  },
  { name: 'Physique-Chimie', shortName: 'PC', coefficient: 2 },
  { name: 'Éducation Civique et Morale', shortName: 'ECM', coefficient: 1 },
  { name: 'Éducation Physique et Sportive', shortName: 'EPS', coefficient: 1 },
];

export const LYCEE_SUBJECTS: SubjectSpec[] = [
  { name: 'Français', shortName: 'FRA', coefficient: 4, coefficientC: 2 },
  { name: 'Mathématiques', shortName: 'MATH', coefficient: 2, coefficientC: 5 },
  { name: 'Physique-Chimie', shortName: 'PC', coefficient: 2, coefficientC: 4 },
  {
    name: 'Sciences de la Vie et de la Terre',
    shortName: 'SVT',
    coefficient: 2,
    coefficientC: 3,
  },
  {
    name: 'Philosophie',
    shortName: 'PHILO',
    coefficient: 4,
    coefficientC: 2,
  },
  {
    name: 'Histoire-Géographie',
    shortName: 'HG',
    coefficient: 3,
    coefficientC: 2,
  },
  { name: 'Anglais', shortName: 'ANG', coefficient: 3, coefficientC: 2 },
  { name: 'Espagnol', shortName: 'ESP', coefficient: 2, coefficientC: 1 },
  { name: 'Éducation Civique et Morale', shortName: 'ECM', coefficient: 1 },
  { name: 'Éducation Physique et Sportive', shortName: 'EPS', coefficient: 1 },
];

/** Classe : nom, frais annuels FCFA, classe suivante (promotion), effectif. */
export interface ClassSpec {
  name: string;
  tuitionFee: number;
  /** Classe d'accueil l'année suivante. `null` = classe terminale (sortie). */
  next: string | null;
  /** Classe d'entrée dans l'établissement : recrute de nouveaux élèves. */
  entry?: boolean;
  headcount: number;
}

export const CMB_CLASSES: ClassSpec[] = [
  {
    name: '6ème A',
    tuitionFee: 120000,
    next: '5ème A',
    entry: true,
    headcount: 20,
  },
  {
    name: '6ème B',
    tuitionFee: 120000,
    next: '5ème B',
    entry: true,
    headcount: 19,
  },
  { name: '5ème A', tuitionFee: 130000, next: '4ème A', headcount: 18 },
  { name: '5ème B', tuitionFee: 130000, next: '4ème B', headcount: 18 },
  { name: '4ème A', tuitionFee: 145000, next: '3ème A', headcount: 17 },
  { name: '4ème B', tuitionFee: 145000, next: '3ème B', headcount: 16 },
  { name: '3ème A', tuitionFee: 165000, next: null, headcount: 17 },
  { name: '3ème B', tuitionFee: 165000, next: null, headcount: 16 },
];

export const LMA_CLASSES: ClassSpec[] = [
  {
    name: '2nde A',
    tuitionFee: 210000,
    next: '1ère A',
    entry: true,
    headcount: 20,
  },
  {
    name: '2nde C',
    tuitionFee: 230000,
    next: '1ère C',
    entry: true,
    headcount: 18,
  },
  { name: '1ère A', tuitionFee: 240000, next: 'Tle A', headcount: 18 },
  { name: '1ère C', tuitionFee: 260000, next: 'Tle C', headcount: 16 },
  { name: 'Tle A', tuitionFee: 290000, next: null, headcount: 17 },
  { name: 'Tle C', tuitionFee: 320000, next: null, headcount: 15 },
];

/** Titres d'évaluation par matière, pour éviter les libellés génériques. */
export const EVALUATION_TOPICS: Record<string, string[]> = {
  MATH: [
    'Équations du premier degré',
    'Théorème de Thalès',
    'Calcul littéral',
    'Fonctions affines',
    'Trigonométrie',
    'Probabilités',
    'Suites numériques',
    'Dérivation',
    'Statistiques',
  ],
  FRA: [
    'Le résumé de texte',
    'La dissertation littéraire',
    'Analyse d’un poème',
    'Le commentaire composé',
    'Les figures de style',
    'Étude d’une œuvre intégrale',
  ],
  ANG: [
    'Simple past and present perfect',
    'Reading comprehension',
    'Reported speech',
    'Vocabulary: daily life',
    'Essay writing',
    'Conditional clauses',
  ],
  ESP: [
    'El pretérito indefinido',
    'Comprensión escrita',
    'El subjuntivo',
    'Vocabulario: la familia',
  ],
  HG: [
    'Le relief de la Côte d’Ivoire',
    'La Première Guerre mondiale',
    'La décolonisation en Afrique',
    'Les climats du monde',
    'L’économie ivoirienne',
    'La guerre froide',
  ],
  SVT: [
    'La nutrition des plantes vertes',
    'La reproduction humaine',
    'Le système nerveux',
    'La génétique',
    'Les séismes',
    'L’immunologie',
  ],
  PC: [
    'Les états de la matière',
    'La loi d’Ohm',
    'Les réactions acido-basiques',
    'Les forces et le mouvement',
    'L’oxydoréduction',
    'Les lentilles minces',
  ],
  PHILO: [
    'La conscience et l’inconscient',
    'La liberté',
    'La vérité',
    'L’État et la société',
    'Le travail et la technique',
  ],
  ECM: [
    'Les institutions de la République',
    'Les droits de l’enfant',
    'Le civisme fiscal',
    'La cohésion sociale',
  ],
  EPS: [
    'Athlétisme : course de vitesse',
    'Sports collectifs : handball',
    'Saut en longueur',
    'Endurance',
  ],
};

export const ABSENCE_REASONS = [
  'Maladie (certificat médical fourni)',
  'Rendez-vous médical',
  'Décès dans la famille',
  'Voyage familial',
  'Retard de transport',
  'Convocation administrative',
];
