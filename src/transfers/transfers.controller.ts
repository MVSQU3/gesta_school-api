import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { resolveSchoolId } from '../common/utils/resolve-school';
import {
  ApproveTransferDto,
  CreateTransferRequestDto,
  RejectTransferDto,
  SearchStudentDto,
} from './dto/transfer.dto';
import { TransferRequest } from './entities/transfer-request.entity';
import {
  ForeignStudentMatch,
  SharedFile,
  TransfersService,
} from './transfers.service';

/**
 * Transfert de dossier scolaire entre établissements.
 *
 * Réservé aux directeurs : accorder à une autre école la lecture du dossier
 * d'un enfant engage l'établissement vis-à-vis de la famille. Ce n'est pas une
 * opération de guichet.
 */
@Controller('api/v1/transfers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.DIRECTOR)
export class TransfersController {
  constructor(private readonly service: TransfersService) {}

  /** Retrouve un élève dans les autres établissements — identité seule. */
  @Post('search')
  async search(
    @CurrentUser() user: AuthUser,
    @Body() dto: SearchStudentDto,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<ForeignStudentMatch[]> {
    return await this.service.searchAcrossSchools(
      resolveSchoolId(user, querySchoolId),
      dto,
    );
  }

  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateTransferRequestDto,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<TransferRequest> {
    return await this.service.create(
      resolveSchoolId(user, querySchoolId),
      user.id,
      dto,
    );
  }

  /** Demandes que l'établissement a émises. */
  @Get('outgoing')
  async outgoing(
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<TransferRequest[]> {
    return await this.service.findOutgoing(resolveSchoolId(user, querySchoolId));
  }

  /** Demandes reçues par l'établissement, à instruire. */
  @Get('incoming')
  async incoming(
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<TransferRequest[]> {
    return await this.service.findIncoming(resolveSchoolId(user, querySchoolId));
  }

  @Patch(':id/approve')
  async approve(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: ApproveTransferDto,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<TransferRequest> {
    return await this.service.approve(
      id,
      resolveSchoolId(user, querySchoolId),
      user.id,
      dto,
    );
  }

  @Patch(':id/reject')
  async reject(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: RejectTransferDto,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<TransferRequest> {
    return await this.service.reject(
      id,
      resolveSchoolId(user, querySchoolId),
      user.id,
      dto,
    );
  }

  @Patch(':id/revoke')
  async revoke(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: { reason?: string },
    @Query('schoolId') querySchoolId?: string,
  ): Promise<TransferRequest> {
    return await this.service.revoke(
      id,
      resolveSchoolId(user, querySchoolId),
      user.id,
      body?.reason,
    );
  }

  /** Le dossier partagé : des bulletins, et rien d'autre. */
  @Get(':id/file')
  async file(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<SharedFile> {
    return await this.service.getSharedFile(
      id,
      resolveSchoolId(user, querySchoolId),
    );
  }
}
