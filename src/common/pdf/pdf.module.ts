import { Global, Module } from '@nestjs/common';
import { PdfService } from './pdf.service';

/**
 * Global : la fabrique PDF est sans état et sans dépendance, plusieurs modules
 * l'utilisent (caisse, bulletins). L'exposer globalement évite de la déclarer
 * dans chacun.
 */
@Global()
@Module({
  providers: [PdfService],
  exports: [PdfService],
})
export class PdfModule {}
