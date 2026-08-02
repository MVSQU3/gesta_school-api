import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Counter, CounterScope } from './counter.entity';

/**
 * Génération des références documentaires de l'application
 * (références d'inscription et numéros de reçu de caisse).
 */
@Injectable()
export class ReferencesService {
  constructor(
    @InjectRepository(Counter)
    private readonly counterRepository: Repository<Counter>,
  ) {}

  /**
   * Réserve et renvoie le prochain numéro de séquence pour un couple
   * (école, type de document, année).
   *
   * L'incrément se fait dans un unique UPSERT `ON CONFLICT DO UPDATE ... RETURNING`,
   * atomique côté PostgreSQL : deux appels concurrents ne peuvent pas obtenir
   * le même numéro, la ligne étant verrouillée pour la durée de la mise à jour.
   *
   * @param manager EntityManager optionnel, à fournir pour rester dans une
   *                transaction appelante (le numéro est alors libéré en cas de rollback).
   */
  async nextSequence(
    schoolId: string,
    scope: CounterScope,
    year: number,
    manager?: EntityManager,
  ): Promise<number> {
    const executor = manager ?? this.counterRepository.manager;

    const rows: Array<{ lastValue: number }> = await executor.query(
      `INSERT INTO "counters" ("schoolId", "scope", "year", "lastValue")
       VALUES ($1, $2, $3, 1)
       ON CONFLICT ("schoolId", "scope", "year")
       DO UPDATE SET "lastValue" = "counters"."lastValue" + 1
       RETURNING "lastValue"`,
      [schoolId, scope, year],
    );

    return Number(rows[0].lastValue);
  }

  /**
   * Assemble une référence au format PREFIXE-SLUG-AA-XXXX (ex: INS-CMB-26-0001).
   * La séquence est complétée à 4 chiffres, sans troncature au-delà de 9999.
   */
  private format(
    prefix: string,
    schoolSlug: string,
    year: number,
    sequence: number,
  ): string {
    const yearShort = year.toString().slice(-2);
    const paddedSequence = sequence.toString().padStart(4, '0');
    return `${prefix}-${schoolSlug.toUpperCase()}-${yearShort}-${paddedSequence}`;
  }

  /**
   * Référence d'inscription : INS-CMB-26-0001
   */
  async nextEnrollmentReference(
    schoolId: string,
    schoolSlug: string,
    manager?: EntityManager,
  ): Promise<string> {
    const year = new Date().getFullYear();
    const sequence = await this.nextSequence(
      schoolId,
      CounterScope.ENROLLMENT,
      year,
      manager,
    );
    return this.format('INS', schoolSlug, year, sequence);
  }

  /**
   * Numéro de reçu de caisse : REC-CMB-26-0001
   */
  async nextReceiptNumber(
    schoolId: string,
    schoolSlug: string,
    manager?: EntityManager,
  ): Promise<string> {
    const year = new Date().getFullYear();
    const sequence = await this.nextSequence(
      schoolId,
      CounterScope.RECEIPT,
      year,
      manager,
    );
    return this.format('REC', schoolSlug, year, sequence);
  }
}
