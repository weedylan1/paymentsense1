export interface BusinessInfo {
  companyName: string;
  companyNumber: string;
  registeredAddress: string;
  status: string;
  incorporationDate: string;
  sicCodes: string[];
  natureOfBusiness: string;
  directors: { name: string; role: string }[];
  lastAccountsDate?: string;
  confirmationStatementDate?: string;
  website?: string;
  digitalLinks?: { label: string; url: string }[];
  summary: string;
  sources: string[];
}
