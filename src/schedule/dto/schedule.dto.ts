import { PartialType } from '@nestjs/mapped-types';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateTimeSlotDto {
  @IsString()
  @IsNotEmpty({ message: 'Le libellé du créneau est obligatoire' })
  @MaxLength(40)
  label: string;

  @Matches(TIME_PATTERN, {
    message: "L'heure de début doit être au format HH:MM (ex: 07:30)",
  })
  startTime: string;

  @Matches(TIME_PATTERN, {
    message: "L'heure de fin doit être au format HH:MM (ex: 08:25)",
  })
  endTime: string;

  @IsInt({ message: 'Le rang doit être un nombre entier' })
  @Min(1, { message: 'Le rang commence à 1' })
  @Max(30, { message: 'Le rang ne peut pas dépasser 30' })
  sequence: number;

  @IsOptional()
  @IsBoolean()
  isBreak?: boolean;
}

export class UpdateTimeSlotDto extends PartialType(CreateTimeSlotDto) {}

export class CreateScheduleEntryDto {
  @IsUUID('4', { message: "L'identifiant de l'affectation doit être un UUID valide" })
  teachingAssignmentId: string;

  @IsInt({ message: 'Le jour doit être un nombre entier' })
  @Min(1, { message: 'Le jour doit être compris entre lundi (1) et vendredi (5)' })
  @Max(5, { message: 'Le jour doit être compris entre lundi (1) et vendredi (5)' })
  dayOfWeek: number;

  @IsUUID('4', { message: "L'identifiant du créneau doit être un UUID valide" })
  timeSlotId: string;
}

/** Déplacement d'une séance vers un autre jour ou un autre créneau. */
export class MoveScheduleEntryDto {
  @IsInt()
  @Min(1, { message: 'Le jour doit être compris entre lundi (1) et vendredi (5)' })
  @Max(5, { message: 'Le jour doit être compris entre lundi (1) et vendredi (5)' })
  dayOfWeek: number;

  @IsUUID('4', { message: "L'identifiant du créneau doit être un UUID valide" })
  timeSlotId: string;
}
