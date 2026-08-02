import 'dotenv/config';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Activation de la validation automatique via les DTOs
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  )

  // Activation du CORS pour l'interface Frontend React
  app.enableCors()

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
