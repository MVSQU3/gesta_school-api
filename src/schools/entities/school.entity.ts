import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('schools')
export class School {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'varchar',
    length: 100,
    nullable: false,
  })
  name: string; // Ex: "Collège Moderne de Bouaké"

  @Column({
    type: 'varchar',
    length: 10,
    unique: true,
    nullable: false,
  })
  slug: string; // Ex: "CMB" (Utilisé pour préfixer les références: INS-CMB-26-0001)

  @Column({
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  address: string;

  @Column({
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  phone: string;

  @Column({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt: Date;
}
