import { Global, Module } from '@nestjs/common';
import { CsvService } from './csv.service';

/**
 * Génération de fichiers tableur. Module global : l'export est un besoin
 * transversal — caisse, dossiers, effectifs — et ne justifie pas d'être
 * réimporté dans chaque module métier.
 */
@Global()
@Module({
  providers: [CsvService],
  exports: [CsvService],
})
export class ExportModule {}
