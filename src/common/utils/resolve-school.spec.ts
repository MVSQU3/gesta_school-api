import { ForbiddenException } from '@nestjs/common';
import { AuthUser } from '../decorators/current-user.decorator';
import { Role } from '../enums/role.enum';
import { resolveSchoolId } from './resolve-school';

/**
 * Cette fonction est le pivot du cloisonnement multi-établissement : elle est
 * appelée par presque toutes les routes. Une erreur ici ouvrirait les données
 * d'une école au personnel d'une autre.
 */
describe('resolveSchoolId (cloisonnement multi-établissement)', () => {
  const user = (roles: Role[], schoolId: string | null = 'school-1') =>
    ({ id: 'u1', email: 'x@y.ci', roles, schoolId, slug: 'CMB' }) as AuthUser;

  it('ramène le personnel à son propre établissement', () => {
    expect(resolveSchoolId(user([Role.DIRECTOR]))).toBe('school-1');
  });

  it.each([
    [Role.DIRECTOR],
    [Role.SECRETARY],
    [Role.ACCOUNTANT],
    [Role.TEACHER],
  ])('ignore le schoolId passé en query pour un %s', (role) => {
    // C'est la garantie centrale : un directeur qui forge
    // `?schoolId=<autre école>` reste sur la sienne.
    expect(resolveSchoolId(user([role]), 'school-voisine')).toBe('school-1');
  });

  it('laisse le SUPER_ADMIN désigner sa cible', () => {
    // Il n'est rattaché à aucune école : sans ce paramètre il ne pourrait
    // administrer aucune.
    expect(resolveSchoolId(user([Role.SUPER_ADMIN], null), 'school-2')).toBe(
      'school-2',
    );
  });

  it('refuse un SUPER_ADMIN qui ne désigne aucune école', () => {
    expect(() => resolveSchoolId(user([Role.SUPER_ADMIN], null))).toThrow(
      ForbiddenException,
    );
  });

  it('refuse un compte de personnel sans établissement', () => {
    expect(() => resolveSchoolId(user([Role.SECRETARY], null))).toThrow(
      ForbiddenException,
    );
  });

  it('privilégie le rôle SUPER_ADMIN quand il est cumulé', () => {
    expect(
      resolveSchoolId(user([Role.DIRECTOR, Role.SUPER_ADMIN]), 'school-2'),
    ).toBe('school-2');
  });
});
