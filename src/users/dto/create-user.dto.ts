import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
  IsArray,
  IsEnum,
  IsUUID,
} from 'class-validator';
import { Role } from '../../common/enums/role.enum';
import {
  MIN_PASSWORD_LENGTH,
  PASSWORD_TOO_SHORT,
} from '../../common/security/password-policy';

export class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(MIN_PASSWORD_LENGTH, { message: PASSWORD_TOO_SHORT })
  password: string;

  @IsArray()
  @IsEnum(Role, { each: true })
  roles: Role[];

  @IsOptional()
  @IsString()
  slug?: string;

  @IsOptional()
  @IsUUID()
  schoolId?: string;
}
