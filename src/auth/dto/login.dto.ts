import { IsEmail, IsString, MinLength, IsOptional } from 'class-validator';

export class LoginDto {

  @IsOptional()
  @IsString()
  slug?: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;
}
