import 'dotenv/config';
import { DataSource } from 'typeorm';

/**
 * Source de données destinée au CLI TypeORM (génération et exécution des
 * migrations). Elle est volontairement distincte de la configuration
 * d'`app.module.ts`, qui sert au démarrage de l'application.
 *
 * Les deux doivent décrire la même base et les mêmes entités : c'est de la
 * comparaison entre les entités et le schéma réel que `migration:generate`
 * déduit le SQL à produire.
 *
 * Utilisation :
 *   npm run migration:generate -- src/migrations/NomDeLaMigration
 *   npm run migration:run
 *   npm run migration:show
 */
export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  entities: ['src/**/*.entity.ts'],
  migrations: ['src/migrations/*.ts'],
  // Jamais de synchronisation automatique ici : le schéma n'évolue que par
  // migrations, et c'est tout l'objet de ce fichier.
  synchronize: false,
});
