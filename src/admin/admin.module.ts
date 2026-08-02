import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Student, School, User } from "../entities/index";
import { AdminService } from "./admin.service";
import { AdminController } from "./admin.controller";

@Module({
    imports: [TypeOrmModule.forFeature([Student, School, User])],
    controllers: [AdminController],
    providers: [AdminService],
    exports: [AdminService],
})
export class AdminModule { }