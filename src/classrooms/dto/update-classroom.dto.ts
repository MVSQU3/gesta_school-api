import { PartialType } from '@nestjs/mapped-types';
import { CreateClassRoomDto } from './create-classroom.dto';

export class UpdateClassRoomDto extends PartialType(CreateClassRoomDto) {}
