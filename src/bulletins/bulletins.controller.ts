import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Response } from 'express';
import { AcademicYear } from '../academic-years/entities/academic-year.entity';
import { ClassRoom } from '../classrooms/entities/classroom.entity';
import { School } from '../schools/entities/school.entity';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { GradingPeriod } from '../grading-periods/entities/grading-period.entity';
import { PdfService } from '../common/pdf/pdf.service';
import { buildBulletinPdf, buildClassBulletinsPdf } from './bulletin.pdf';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { resolveSchoolId } from '../common/utils/resolve-school';
import { BulletinsService } from './bulletins.service';

@Controller('api/v1/bulletins')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BulletinsController {
  constructor(
    private readonly service: BulletinsService,
    private readonly pdfService: PdfService,
    @InjectRepository(School)
    private readonly schoolRepository: Repository<School>,
    @InjectRepository(ClassRoom)
    private readonly classRoomRepository: Repository<ClassRoom>,
    @InjectRepository(AcademicYear)
    private readonly academicYearRepository: Repository<AcademicYear>,
    @InjectRepository(Enrollment)
    private readonly enrollmentRepository: Repository<Enrollment>,
  ) {}

  /** Bulletins de toute une classe pour une période, avec rangs. */
  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR, Role.SECRETARY)
  @Get('classroom/:classRoomId')
  async getClassBulletins(
    @Param('classRoomId') classRoomId: string,
    @Query('gradingPeriodId') gradingPeriodId: string,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ) {
    return await this.service.getClassBulletins(
      resolveSchoolId(user, querySchoolId),
      classRoomId,
      gradingPeriodId,
    );
  }

  /** Bulletins de toute une classe en PDF, un élève par page. */
  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR, Role.SECRETARY)
  @Get('classroom/:classRoomId/pdf')
  async classBulletinsPdf(
    @Param('classRoomId') classRoomId: string,
    @Query('gradingPeriodId') gradingPeriodId: string,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<void> {
    const schoolId = resolveSchoolId(user, querySchoolId);
    const { period, bulletins } = await this.service.getClassBulletins(
      schoolId,
      classRoomId,
      gradingPeriodId,
    );
    const ctx = await this.buildContext(schoolId, classRoomId, period);

    const pdf = await this.pdfService.render(
      buildClassBulletinsPdf(bulletins, ctx),
    );
    this.sendPdf(
      res,
      pdf,
      `bulletins-${(ctx.className ?? 'classe').replace(/\s+/g, '-')}-${period.label.replace(/\s+/g, '-')}.pdf`,
    );
  }

  /** Bulletin d'un seul élève en PDF. */
  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR, Role.SECRETARY)
  @Get('enrollment/:enrollmentId/pdf')
  async studentBulletinPdf(
    @Param('enrollmentId') enrollmentId: string,
    @Query('gradingPeriodId') gradingPeriodId: string,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<void> {
    const schoolId = resolveSchoolId(user, querySchoolId);
    const { period, bulletin } = await this.service.getStudentBulletin(
      schoolId,
      enrollmentId,
      gradingPeriodId,
    );

    const enrollment = await this.enrollmentRepository.findOne({
      where: { id: enrollmentId },
    });
    const ctx = await this.buildContext(
      schoolId,
      enrollment?.classRoomId ?? '',
      period,
    );

    const pdf = await this.pdfService.render(buildBulletinPdf(bulletin, ctx));
    this.sendPdf(
      res,
      pdf,
      `bulletin-${bulletin.lastName}-${bulletin.firstName}.pdf`.replace(/\s+/g, '-'),
    );
  }

  /**
   * Éléments d'en-tête du bulletin : nom de l'établissement, année scolaire et
   * classe, qui ne figurent pas dans le calcul mais doivent être imprimés.
   */
  private async buildContext(
    schoolId: string,
    classRoomId: string,
    period: GradingPeriod,
  ) {
    const [school, classRoom, academicYear] = await Promise.all([
      this.schoolRepository.findOne({ where: { id: schoolId } }),
      classRoomId
        ? this.classRoomRepository.findOne({ where: { id: classRoomId } })
        : null,
      this.academicYearRepository.findOne({
        where: { id: period.academicYearId },
      }),
    ]);

    return {
      period,
      schoolName: school?.name,
      className: classRoom?.name,
      academicYearLabel: academicYear?.label,
    };
  }

  private sendPdf(res: Response, pdf: Buffer, filename: string) {
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Content-Length': pdf.length.toString(),
    });
    res.end(pdf);
  }

  /** Bulletin d'un élève, prêt à être imprimé. */
  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR, Role.SECRETARY)
  @Get('enrollment/:enrollmentId')
  async getStudentBulletin(
    @Param('enrollmentId') enrollmentId: string,
    @Query('gradingPeriodId') gradingPeriodId: string,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ) {
    return await this.service.getStudentBulletin(
      resolveSchoolId(user, querySchoolId),
      enrollmentId,
      gradingPeriodId,
    );
  }
}
