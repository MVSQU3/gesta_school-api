<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Mise en service

Variables à renseigner impérativement avant d'exposer l'API (voir `.env.example`) :

| Variable | Rôle |
| --- | --- |
| `NODE_ENV=production` | Active HSTS et le contrôle strict de la configuration |
| `CORS_ORIGINS` | URL de l'interface web. **L'API refuse de démarrer sans, en production** |
| `JWT_SECRET` | À régénérer : `openssl rand -base64 48` |
| `SUPER_ADMIN_PASSWORD` | À changer — la valeur d'exemple est publique |
| `TRUST_PROXY=true` | Uniquement derrière nginx/Caddy/Traefik, jamais si l'API est exposée directement |

Côté interface web, `VITE_API_URL` doit être définie **au moment du build** — Vite
fige la valeur dans le bundle, elle n'est pas lue au démarrage :

```bash
VITE_API_URL=https://api.ecole.exemple.ci/api/v1 npm run build
```

**Sonde de supervision** : `GET /api/v1/health`, publique et non authentifiée.
Elle interroge réellement PostgreSQL et renvoie `503` si la base ne répond plus,
pour qu'un load balancer retire l'instance de la rotation au lieu de continuer à
lui envoyer du trafic.

```json
{ "status": "ok", "uptimeSeconds": 21, "database": { "status": "up", "latencyMs": 28 } }
```

**Connexion** : 10 tentatives par quart d'heure et par couple (poste, compte).
Le décompte porte sur le couple et non sur l'adresse seule — dans un
établissement, tout le monde partage la même IP publique, et compter par IP
bloquerait le secrétariat entier dès qu'un poste se trompe de mot de passe.

## Journal d'audit

Les opérations **administratives** sont tracées dans la table `audit_logs` :
tarifs et classes, comptes du personnel (création, rôles, activation,
réinitialisation de mot de passe, suppression), corrections de dossiers et de
fiches élèves, réinscriptions en masse, clôtures de périodes de notation.

Les **encaissements n'y figurent pas** : ils portent déjà leur propre
traçabilité sur la ligne de paiement (caissier, date, annulation avec motif et
auteur), qui est une pièce comptable.

Principes :

- **ajout seul** — aucune route d'écriture, de modification ou de suppression
  n'est exposée ; un journal qu'on peut retoucher ne prouve rien ;
- **jamais bloquant** — si l'écriture du journal échoue, l'opération métier
  aboutit quand même et l'incident part dans les logs du serveur ;
- **lisible** — chaque ligne porte une phrase composée à l'écriture (« Tarif de
  la classe 6ème A porté de 120 000 à 135 000 FCFA ») plus le détail
  avant/après en JSON ;
- l'adresse de l'auteur est **recopiée** sur la ligne : elle survit à la
  suppression du compte ;
- consultation **réservée à la direction** (`GET /api/v1/audit`, onglet
  « Journal d'audit » de l'espace direction), avec export CSV
  (`GET /api/v1/audit/export`).

La table est créée par la migration `AddAuditLog` : `npm run migration:run`
avant la mise en service.

## Exports tableur

Deux exports, accessibles depuis l'interface (bouton « Exporter (CSV) ») ou
directement :

| Route | Contenu | Rôles |
| --- | --- | --- |
| `GET /api/v1/payments/export` | Journal de caisse : un versement par ligne, annulations comprises avec leur motif et leur auteur | Direction, comptabilité |
| `GET /api/v1/enrollments/export` | État des dossiers avec la situation financière de chacun — document de relance | Direction, secrétariat, comptabilité |

Les deux acceptent **les mêmes filtres que les écrans correspondants**
(période, mode de règlement, classe, année, statut, recherche) et ignorent la
pagination : un journal exporté sur une page de vingt-cinq lignes ne servirait
à rien à la comptabilité.

Le format est du CSV calibré pour Excel en configuration française :
séparateur point-virgule, BOM UTF-8 (sans lui, Excel affiche « KouassiÃ© »),
fins de ligne CRLF, dates en `JJ/MM/AAAA HH:MM`. Le fichier s'ouvre d'un
double-clic dans Excel comme dans LibreOffice. Un vrai `.xlsx` demanderait une
dépendance supplémentaire ; le CSV reste par ailleurs réimportable dans
n'importe quel outil comptable.

## Jeu de données de démonstration

Le script `src/seeds/seed.ts` peuple une base **déjà migrée** (`npm run migration:run`)
avec deux établissements complets et cohérents.

```bash
npm run seed
```

⚠️ Le script commence par **vider toutes les tables métier** (`TRUNCATE ... CASCADE`).
Il refuse de s'exécuter si `NODE_ENV=production`, sauf `npm run seed -- --force`.

Contenu :

| Établissement | Slug | Découpage | Classes | Niveau |
| --- | --- | --- | --- | --- |
| Collège Moderne de Bouaké | `CMB` | Trimestre (3 périodes) | 6ème → 3ème, 8 classes | COLLEGE |
| Lycée Moderne d'Abidjan | `LMA` | Semestre (2 périodes) | 2nde → Tle, séries A et C | LYCEE |

Chacun reçoit ses utilisateurs, son programme (matières + coefficients par classe,
différenciés entre séries littéraire et scientifique), ses affectations
d'enseignants, et deux années scolaires :

- **2025-2026** — close, dossiers soldés pour l'essentiel, intégralement notée
  (évaluations, notes, absences par demi-journée) ;
- **2026-2027** — année active, campagne d'inscription en cours : réinscriptions
  avec passage en classe supérieure, nouveaux entrants en 6ème et en 2nde,
  dossiers en attente, partiellement payés ou expirés.

Les invariants métier sont respectés : statut d'inscription déduit de la somme des
versements non annulés, `expiresAt` à 72 h, références `INS/REC-SLUG-AA-XXXX` avec
compteurs `counters` positionnés, notes rattachées à l'inscription et limitées aux
matières réellement au programme de la classe. Le tirage est déterministe : deux
exécutions produisent les mêmes élèves et les mêmes notes.

Comptes créés — mot de passe commun `Gesta@2026` :

| Compte | Rôle |
| --- | --- |
| `superadmin@gesta-school.ci` | SUPER_ADMIN |
| `direction@college-bouake.edu.ci` | DIRECTOR (CMB) |
| `secretariat@college-bouake.edu.ci` | SECRETARY (CMB) |
| `comptabilite@college-bouake.edu.ci` | ACCOUNTANT (CMB) |
| `direction@lycee-abidjan.edu.ci` | DIRECTOR (LMA) |
| `secretariat@lycee-abidjan.edu.ci` | SECRETARY (LMA) |
| `comptabilite@lycee-abidjan.edu.ci` | ACCOUNTANT (LMA) |
| `prenom.nom@<domaine>` | TEACHER (un par matière) |

Deux cas particuliers sont volontairement présents pour tester l'authentification :
`secretariat2@…` avec un mot de passe provisoire à changer, et `caisse.ancien@…`
désactivé mais toujours rattaché à ses saisies passées.

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
