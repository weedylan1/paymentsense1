import Dexie, { type Table } from 'dexie';
import { BusinessInfo } from './types';

export interface SavedBusiness extends BusinessInfo {
  id?: number;
  savedAt: number;
}

export class MyDatabase extends Dexie {
  savedBusinesses!: Table<SavedBusiness>;

  constructor() {
    super('UKBusinessInsightExplorer');
    this.version(1).stores({
      savedBusinesses: '++id, companyName, companyNumber, status, savedAt'
    });
  }
}

export const db = new MyDatabase();
