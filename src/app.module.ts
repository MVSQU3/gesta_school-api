import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AcademicYearsModule } from './academic-years/academic-years.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ClassRoomsModule } from './classrooms/classrooms.module';
import { CronModule } from './cron/cron.module';
import { EnrollmentsModule } from './enrollments/enrollments.module';
import { PaymentsModule } from './payments/payments.module';
import { SchoolsModule } from './schools/schools.module';
import { StudentsModule } from './students/students.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { AdminModule } from './admin/admin.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { AuditModule } from './audit/audit.module';
import { ExportModule } from './common/export/export.module';
import { PdfModule } from './common/pdf/pdf.module';
import { GradingPeriodsModule } from './grading-periods/grading-periods.module';
import { SubjectsModule } from './subjects/subjects.module';
import { TeachingModule } from './teaching/teaching.module';
import { EvaluationsModule } from './evaluations/evaluations.module';
import { AbsencesModule } from './absences/absences.module';
import { BulletinsModule } from './bulletins/bulletins.module';
import { ScheduleModule as TimetableModule } from './schedule/schedule.module';
import { TransfersModule } from './transfers/transfers.module';
import { HealthModule } from './health/health.module';
import { ParentsModule } from './parents/parents.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PdfModule,
    ExportModule,
    AuditModule,
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT || '5432'),
      username: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_DATABASE,
      entities: [__dirname + '/**/*.entity{.ts,.js}'],
      migrations: [__dirname + '/migrations/*{.ts,.js}'],

      /**
       * `synchronize` aligne le schéma sur les entités à chaque démarrage — et
       * supprime sans prévenir toute colonne ou table qu'il ne reconnaît pas.
       * Il reste désactivé par défaut : le schéma n'évolue que par migrations.
       *
       * DB_SYNCHRONIZE=true reste possible pour un prototypage sur base
       * jetable, jamais sur une base contenant des données réelles.
       */
      synchronize: process.env.DB_SYNCHRONIZE === 'true',

      /**
       * Exécution des migrations au démarrage. Désactivée par défaut : on
       * préfère `npm run migration:run` avant la mise en service, pour qu'un
       * échec de migration soit traité comme tel plutôt que comme un
       * démarrage raté.
       */
      migrationsRun: process.env.DB_MIGRATIONS_RUN === 'true',
    }),
    SchoolsModule,
    StudentsModule,
    ClassRoomsModule,
    AcademicYearsModule,
    EnrollmentsModule,
    PaymentsModule,
    CronModule,
    UsersModule,
    AuthModule,
    AdminModule,
    DashboardModule,
    // Notation et assiduité
    GradingPeriodsModule,
    SubjectsModule,
    TeachingModule,
    EvaluationsModule,
    AbsencesModule,
    BulletinsModule,
    TransfersModule,
    TimetableModule,
    ParentsModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
