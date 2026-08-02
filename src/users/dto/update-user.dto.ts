import { ArrayNotEmpty, IsArray, IsBoolean, IsEmail, IsEnum, IsOptional } from 'class-validator';
import { Role } from '../../common/enums/role.enum';

export class UpdateUserDto {
  @IsOptional()
  @IsEmail({}, { message: "L'adresse email doit être valide" })
  email?: string;

  @IsOptional()
  @IsArray({ message: 'Les rôles doivent être fournis sous forme de liste' })
  @ArrayNotEmpty({ message: 'Au moins un rôle est obligatoire' })
  @IsEnum(Role, { each: true, message: 'Rôle inconnu' })
  roles?: Role[];
}

export class SetUserStatusDto {
  @IsBoolean({ message: 'Le statut actif doit être un booléen' })
  isActive: boolean;
}
