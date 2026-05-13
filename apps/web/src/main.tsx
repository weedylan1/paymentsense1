import { Fragment, StrictMode, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, FormEvent, ReactNode, SetStateAction } from "react";
import { createRoot } from "react-dom/client";
import { Activity, Archive, ArrowLeft, ArrowRight, BadgeCheck, Ban, Bookmark, BookmarkCheck, Building2, Calendar, ChevronDown, ChevronRight, CircleAlert, CircleHelp, Copy, Database, Download, ExternalLink, Eye, EyeOff, FileText, Filter, GitCompareArrows, Globe, Hash, Info, Loader2, MapPin, MapPinned, Megaphone, Search, SearchCheck, Smile, Trash2, Users } from "lucide-react";
import L from "leaflet";
import { GoogleGenAI, Type } from "@google/genai";
import "leaflet/dist/leaflet.css";
import "./styles.css";

const apiBase =
  import.meta.env.VITE_API_BASE_URL ??
  `${window.location.protocol}//${window.location.hostname}:5157`;
const actorUserStorageKey = "matchlab.currentUserId";
const nativeFetch = window.fetch.bind(window);

type Dashboard = {
  searchRuns: number;
  extractedRecords: number;
  organisations: number;
  prospects: number;
  customers: number;
  candidateMatches: number;
  needsReviewMatches: number;
};

type ActivityEvent = {
  id: number;
  eventType: string;
  entityType: string;
  entityId?: number;
  title: string;
  description: string;
  actorUserId?: number;
  actorName?: string;
  createdAt: string;
  isNotifiable: boolean;
};

type Lead = {
  id: number;
  customerId: number;
  leadStatus: string;
  leadPriority: LeadPriority;
  assignedUserId?: number;
  assignedUserName?: string;
  createdAt: string;
  customerRef?: string;
  mid?: string;
  customerName: string;
  tradingName?: string;
  tradingAddress?: string;
  postcode?: string;
  regionId?: number;
  regionName?: string;
  customerActivityStatusId?: number;
  customerActivityStatusName?: string;
  customerValueTypeId?: number;
  customerValueTypeLabel?: string;
  contactPhone?: string;
  contactEmail?: string;
  prospects?: LeadProspect[];
  prospectCount: number;
  contactHistoryCount: number;
};

type LeadDetail = Lead & {
  commercials?: CustomerCommercials;
  prospects: LeadProspect[];
  contactHistory: LeadContactHistory[];
};

type LeadPriority = "very_low" | "low" | "medium" | "high" | "urgent";

type LeadProspect = {
  prospectId: string;
  businessName: string;
  contactName?: string;
  contactEmail?: string;
  ownerName?: string;
  addressLine1?: string;
  postcode?: string;
  isPrimary: boolean;
};

type LeadContactHistory = {
  id: number;
  channel: string;
  contactedAt: string;
  outcome?: string;
  notes?: string;
  reason?: string;
  whoBy?: string;
  responseStatus?: string;
};

type LeadContactHistoryFormState = {
  channel: string;
  contactedAt: string;
  reason: string;
  whoBy: string;
  responseStatus: string;
};

type LeadNote = {
  id: number;
  noteText: string;
  notedAt: string;
  userId?: number;
  userName?: string;
};

type LeadNoteFormState = {
  noteText: string;
  notedAt: string;
  userId: string;
};

type GdprEntry = {
  id: number;
  emailAddress?: string;
  name?: string;
  address?: string;
  createdAt: string;
};

type User = {
  id: number;
  fullName: string;
  initials: string;
  phone?: string;
  email?: string;
  color?: string;
  createdAt: string;
};

type Campaign = {
  id: number;
  name: string;
  description?: string;
  objective?: string;
  startDate?: string;
  endDate?: string;
  targetAudience?: string;
  budget?: number;
  productService?: string;
  status: string;
  createdAt: string;
  waves: CampaignWave[];
};

type CampaignWave = {
  id: number;
  campaignId: number;
  name: string;
  waveNumber: number;
  channel: string;
  scheduledDate?: string;
  status: string;
  assignedTeamOrUser?: string;
  createdAt: string;
};

type SearchRun = {
  id: number;
  queryText: string;
  sourceUrl?: string;
  executedAt: string;
  completedAt?: string;
  countsJson: string;
  notes?: string;
};

type Prospect = {
  id: number;
  prospectId: string;
  businessName: string;
  addedAt: string;
  createdOn?: string;
  ownerName?: string;
  hasPaymentsenseCustomerMatch?: boolean;
  contactName?: string;
  contactEmail?: string;
  postcode?: string;
  channel?: string;
  origin?: string;
  addressLine1?: string;
  town?: string;
  county?: string;
  contactPhone?: string;
  hasStoredDetail: boolean;
  hasLead: boolean;
};

type Customer = {
  id: number;
  customerKind: string;
  customerRef?: string;
  mid?: string;
  addedAt: string;
  entityName: string;
  tradingName?: string;
  tradingAddress?: string;
  postcode?: string;
  startDate?: string;
  status?: string;
  suppressionReason?: string;
  regionId?: number;
  regionName?: string;
  customerActivityStatusId?: number;
  customerActivityStatusName?: string;
  customerValueTypeId?: number;
  customerValueTypeLabel?: string;
  customerValueTypeDecimalValue?: number;
  customerValueTypeShieldOrder?: number;
  customerValueTypeImageFileName?: string;
  assignedUserId?: number;
  assignedUserName?: string;
  isBookmarked: boolean;
  hasAnyBookmark: boolean;
  hasNotes: boolean;
  hasOwnedChecklistMatch: boolean;
  hasStoredMatches: boolean;
  attachedProspectCount: number;
  hasLead: boolean;
  hasAiInsight: boolean;
  hasAiInsightJobScheduled: boolean;
};

type DuplicateReason = {
  key: string;
  label: string;
  value: string;
  count: number;
  text: string;
};

type CustomerMapPage = {
  items: CustomerMapRow[];
  total: number;
  page: number;
  pageSize: number;
};

type CustomerMapRow = {
  id: number;
  customerRef?: string;
  mid?: string;
  addedAt: string;
  entityName: string;
  tradingName?: string;
  tradingAddress?: string;
  postcode?: string;
  status?: string;
  regionId?: number;
  regionName?: string;
  customerActivityStatusId?: number;
  customerActivityStatusName?: string;
  customerValueTypeId?: number;
  customerValueTypeLabel?: string;
  assignedUserId?: number;
  assignedUserName?: string;
  isBookmarked: boolean;
  hasStoredMatches: boolean;
  latitude?: number;
  longitude?: number;
  geocodeAccuracy?: string;
  geocodeStatus?: string;
  leadPriority?: LeadPriority;
};

type CustomerMapGeocodeResponse = {
  results: CustomerMapGeocodeResult[];
};

type CustomerMapGeocodeResult = {
  customerId: number;
  status: string;
  latitude?: number;
  longitude?: number;
  accuracy?: string;
  error?: string;
};

type SavedCustomerMap = {
  id: number;
  name: string;
  customerCount: number;
  createdAt: string;
  updatedAt: string;
};

type SavedCustomerMapDetail = {
  id: number;
  name: string;
  customerIds: number[];
  createdAt: string;
  updatedAt: string;
};

type CustomerNote = {
  id: number;
  noteText: string;
  createdAt: string;
  createdByUserId?: number;
  createdByUserName?: string;
};

type Region = {
  id: number;
  name: string;
  createdAt: string;
  updatedAt: string;
};

type CompanySicCode = {
  code: string;
  description: string;
};

type BusinessType = {
  id: number;
  name: string;
  sicCode?: string;
  sicDescription?: string;
  createdAt: string;
  updatedAt: string;
};

type CustomerValueType = {
  id: number;
  shieldOrder: number;
  shieldKey: string;
  imageFileName: string;
  label?: string;
  decimalValue?: number;
  createdAt: string;
  updatedAt: string;
};

type BusinessInfo = {
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
  turnover?: string;
  employeeCount?: string;
  website?: string;
  digitalLinks?: { label: string; url: string }[];
  summary: string;
  sources: string[];
};

type AiCompanyInsight = {
  id: number;
  searchName: string;
  searchLocation?: string;
  companyName: string;
  companyNumber: string;
  status?: string;
  insight: BusinessInfo;
  createdByUserId?: number;
  createdByUserName?: string;
  createdAt: string;
  updatedAt: string;
};

type QueuedJob = {
  id: number;
  jobType: string;
  displayName: string;
  status: string;
  payload: Record<string, unknown>;
  result?: Record<string, unknown> | null;
  requestedByUserId?: number;
  requestedByUserName?: string;
  scheduledFor: string;
  queuedAt?: string;
  startedAt?: string;
  completedAt?: string;
  lastHeartbeatAt?: string;
  attemptCount: number;
  maxAttempts: number;
  cancelRequested: boolean;
  currentStep?: string;
  errorText?: string;
  removedAt?: string;
  removedByUserId?: number;
  removedByUserName?: string;
  createdAt: string;
  updatedAt: string;
};

type QueueMetrics = {
  queueName: string;
  available: boolean;
  readyCount: number;
  unackedCount: number;
  consumerCount: number;
  error?: string;
};

type QueuedJobSummary = {
  total: number;
  pending: number;
  queued: number;
  running: number;
  completed: number;
  failed: number;
  cancelRequested: number;
  cancelled: number;
};

type JobOverview = {
  summary: QueuedJobSummary;
  queue: QueueMetrics;
};

type JobAiInsightModalState = {
  job: QueuedJob;
  insight: BusinessInfo;
};

type AiInsightContext = {
  customerId?: number;
  customerLabel?: string;
  tradingName?: string;
  postcode?: string;
  sourceView?: "customers" | "dashboard";
};

type CustomerAiInsightSummary = {
  id: number;
  searchName: string;
  searchLocation?: string;
  companyName: string;
  companyNumber: string;
  status?: string;
  registeredAddress?: string;
  incorporationDate?: string;
  natureOfBusiness?: string;
  turnover?: string;
  employeeCount?: string;
  website?: string;
  digitalLinks: { label: string; url: string }[];
  updatedAt: string;
};

type CustomerRowContextMenuState = {
  customer: Customer;
  x: number;
  y: number;
};

type CustomerBusinessTypeOption = {
  key: string;
  name: string;
  sicCode?: string;
  description?: string;
  source: "custom" | "sic";
};

type CustomerBusinessType = {
  key: string;
  name: string;
  sicCode?: string;
  description?: string;
  source: "custom" | "sic";
};

type CustomerActivityStatusOption = {
  id: number;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

type LeadStatusOption = {
  id: number;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

type CustomerMatchResult = {
  customerId: number;
  generatedNow: boolean;
  matches: CustomerProspectMatch[];
  lead?: LeadSummary;
  suppressionReason?: string;
  commercials?: CustomerCommercials;
  businessTypes: CustomerBusinessType[];
  aiInsight?: CustomerAiInsightSummary;
};

type CustomerCommercials = {
  creditCardValue?: number;
  valuePeriod?: "monthly" | "yearly";
  currentChargePercent?: number;
  proposedChargePercent?: number;
  currentChargeAmount?: number;
  proposedChargeAmount?: number;
  differenceAmount?: number;
  customerValueTypeId?: number;
  customerValueTypeLabel?: string;
  customerValueTypeDecimalValue?: number;
  customerValueTypeShieldOrder?: number;
  customerValueTypeImageFileName?: string;
};

type CustomerCommercialsFormState = {
  creditCardValue: string;
  valuePeriod: "monthly" | "yearly";
  currentChargePercent: string;
  proposedChargePercent: string;
  customerValueTypeId: string;
};

type CustomerProspectMatch = {
  matchId: number;
  prospectId: string;
  businessName: string;
  contactName?: string;
  contactEmail?: string;
  ownerName?: string;
  addressLine1?: string;
  postcode?: string;
  score: number;
  status: string;
  reasons: string[];
  generatedNow: boolean;
  hasStoredDetail: boolean;
};

type LeadSummary = {
  id: number;
  customerId: number;
  leadStatus: string;
  createdAt: string;
};

type LeadViewState = {
  searchText: string;
  statusFilter: string;
  priorityFilter: string;
  assignedUserId: string;
  selectedCampaignId: string;
  selectedWaveId: string;
  sortKey: "id" | "customerName" | "assignedUserName" | "tradingName" | "postcode" | "leadPriority" | "prospectCount" | "contactHistoryCount" | "leadStatus" | "createdAt";
  sortDirection: SortDirection;
};

type CustomerSearchPreview = {
  query: string;
  searchUrl: string;
  rows: CustomerSearchRow[];
};

type CustomerSearchRow = {
  customerRef?: string;
  entity: string;
  mid?: string;
  tradingName?: string;
  tradingAddress?: string;
  town?: string;
  county?: string;
  tradingPostcode?: string;
  startDate?: string;
  status?: string;
  sourceUrl?: string;
  added: boolean;
};

type CustomerImportMatchedCustomer = {
  customerId: number;
  entityName: string;
  tradingName: string | undefined;
  tradingAddress: string | undefined;
  postcode: string | undefined;
  regionName: string | undefined;
  reasons: string[];
};

type CustomerImportMatchResult = {
  rowKey: string;
  row: CustomerSearchRow;
  matches: CustomerImportMatchedCustomer[];
};

type ProspectSearchPreview = {
  query: string;
  searchUrl: string;
  rows: ProspectSearchRow[];
  savedSearchUsed: boolean;
  cachedAt?: string;
  expiresAt?: string;
};

type ProspectSearchRow = {
  prospectId: string;
  businessName: string;
  contactName?: string;
  contactEmail?: string;
  createdOn?: string;
  ownerName?: string;
  sourceUrl?: string;
  postcode?: string;
  hasStoredDetail: boolean;
  added: boolean;
};

type ProspectDetail = {
  prospectId: string;
  businessName: string;
  channel?: string;
  origin?: string;
  createdOn?: string;
  ownerName?: string;
  salesUrl?: string;
  hasPaymentsenseCustomerMatch?: boolean;
  address: {
    line1?: string;
    line2?: string;
    town?: string;
    county?: string;
    postcode?: string;
    country?: string;
  };
  contact: {
    name?: string;
    phone?: string;
    email?: string;
  };
  extractedNow: boolean;
};

type SearchMode = "live" | "stored";
type SortDirection = "asc" | "desc";

type CustomerTestState = {
  query: string;
  submittedQuery: string;
  state: LoadState<CustomerSearchPreview>;
  persistToDatabase: boolean;
  regionId: string;
};

type ProspectTestState = {
  query: string;
  submittedQuery: string;
  state: LoadState<ProspectSearchPreview>;
  mode: SearchMode;
  detail: LoadState<ProspectDetail>;
  selectedProspectId: string;
  persistToDatabase: boolean;
};

type ProspectTestCustomerContext = {
  customerId: number;
  customerRef?: string;
  entityName: string;
  tradingName?: string;
  postcode?: string;
  filterField: "entityName" | "tradingName" | "postcode";
  filterValue: string;
};

type ProspectRowHighlight = {
  matched: boolean;
  reasons: string[];
};

type MatchCandidate = {
  id: number;
  score: number;
  status: string;
  reasonsJson: string;
  prospectId: string;
  prospectName: string;
  customerRef?: string;
  mid?: string;
  customerName: string;
  generatedAt: string;
};

type LoadState<T> = {
  data?: T;
  error?: string;
  loading: boolean;
};

type ProspectPageSortKey = "businessName" | "contactName" | "postcode" | "addedAt";
type ProspectTestSortKey = "prospectId" | "businessName" | "contactName" | "createdOn";
type CustomerPageSortKey = "entityName" | "tradingName" | "postcode" | "addedAt";
type ProspectPageViewState = {
  searchText: string;
  searchDetails: boolean;
  addedFrom?: string;
  addedTo?: string;
  sortKey: ProspectPageSortKey;
  sortDirection: SortDirection;
};
type CustomerPageViewState = {
  searchText: string;
  postcodeText?: string;
  regionId?: string;
  customerActivityStatusId?: string;
  customerValueTypeId?: string;
  assignedUserId?: string;
  onlyBookmarked?: boolean;
  onlyMapped?: boolean;
  onlyCancelled: boolean;
  onlyMatched: boolean;
  addedFrom?: string;
  addedTo?: string;
  sortKey: CustomerPageSortKey;
  sortDirection: SortDirection;
};

type CustomerRegionAssignmentResult = {
  customerId: number;
  previousRegionId?: number;
  previousRegionName?: string;
  regionId?: number;
  regionName?: string;
};

type CustomerNoteModalState = {
  open: boolean;
  customer?: Customer;
  notesState: LoadState<CustomerNote[]>;
  noteText: string;
  notedAt: string;
  saving: boolean;
};

type OwnedChecklistMatch = {
  id: number;
  businessName: string;
  contactName?: string;
  contactEmail?: string;
  ownerName: string;
  createdAt: string;
  expiresAt: string;
  reason: string;
};

type OwnedChecklistModalState = {
  open: boolean;
  customer?: Customer;
  matchesState: LoadState<OwnedChecklistMatch[]>;
};
type BatchFetchState = {
  open: boolean;
  running: boolean;
  completed: boolean;
  total: number;
  completedCount: number;
  successCount: number;
  failedCount: number;
  currentProspectId?: string;
  error?: string;
};

type BatchArchiveState = {
  open: boolean;
  running: boolean;
  completed: boolean;
  total: number;
  completedCount: number;
  successCount: number;
  failedCount: number;
  currentLabel?: string;
};

type ArchiveNotice = {
  kind: "success" | "error";
  message: string;
};

type GdprFormState = {
  emailAddress: string;
  name: string;
  address: string;
};

type RegionFormState = {
  name: string;
};

type CustomerActivityStatusFormState = {
  name: string;
  sortOrder: string;
};

type LeadStatusFormState = {
  name: string;
  sortOrder: string;
};

type BusinessTypeFormState = {
  name: string;
  sicCodeInput: string;
};

type CustomerValueTypeFormState = {
  label: string;
  decimalValue: string;
};

type UserFormState = {
  fullName: string;
  initials: string;
  phone: string;
  email: string;
  color: string;
};

type GeminiSettingsState = {
  apiKey: string;
};

const userColorOptions = [
  { value: "#d62828", label: "Red" },
  { value: "#f77f00", label: "Orange" },
  { value: "#fcbf49", label: "Yellow" },
  { value: "#2a9d8f", label: "Teal" },
  { value: "#2b6cb0", label: "Blue" },
  { value: "#6a4c93", label: "Purple" },
  { value: "#c2185b", label: "Pink" },
  { value: "#4a5568", label: "Slate" }
] as const;

const aiBusinessSchema = {
  type: Type.OBJECT,
  properties: {
    companyName: { type: Type.STRING },
    companyNumber: { type: Type.STRING },
    registeredAddress: { type: Type.STRING },
    status: { type: Type.STRING },
    incorporationDate: { type: Type.STRING },
    sicCodes: { type: Type.ARRAY, items: { type: Type.STRING } },
    natureOfBusiness: { type: Type.STRING },
    directors: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          role: { type: Type.STRING }
        }
      }
    },
    lastAccountsDate: { type: Type.STRING },
    confirmationStatementDate: { type: Type.STRING },
    turnover: { type: Type.STRING },
    employeeCount: { type: Type.STRING },
    website: { type: Type.STRING },
    digitalLinks: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          label: { type: Type.STRING },
          url: { type: Type.STRING }
        }
      }
    },
    summary: { type: Type.STRING },
    sources: { type: Type.ARRAY, items: { type: Type.STRING } }
  },
  required: ["companyName", "companyNumber", "sicCodes", "summary"]
} as const;

type CampaignFormState = {
  name: string;
  description: string;
  objective: string;
  startDate: string;
  endDate: string;
  targetAudience: string;
  budget: string;
  productService: string;
  status: string;
};

type CampaignWaveFormState = {
  name: string;
  waveNumber: string;
  channel: string;
  scheduledDate: string;
  status: string;
  assignedTeamOrUser: string;
};

function App() {
  const [activeView, setActiveView] = useState("dashboard");
  const [refreshKey, setRefreshKey] = useState(0);
  const [currentUserId, setCurrentUserId] = useState(() => window.localStorage.getItem(actorUserStorageKey) ?? "");
  const dashboard = useApi<Dashboard>("/api/dashboard", refreshKey);
  const searchRuns = useApi<SearchRun[]>("/api/search-runs", refreshKey);
  const prospects = useApi<Prospect[]>("/api/prospects", refreshKey);
  const customers = useApi<Customer[]>("/api/customers", refreshKey, currentUserId);
  const regions = useApi<Region[]>("/api/regions", refreshKey);
  const companySicCodes = useApi<CompanySicCode[]>("/api/company-sic-codes", refreshKey);
  const businessTypes = useApi<BusinessType[]>("/api/business-types", refreshKey);
  const customerValueTypes = useApi<CustomerValueType[]>("/api/customer-value-types", refreshKey);
  const aiCompanyInsights = useApi<AiCompanyInsight[]>("/api/ai-company-insights", refreshKey);
  const customerActivityStatuses = useApi<CustomerActivityStatusOption[]>("/api/customer-activity-statuses", refreshKey);
  const leadStatuses = useApi<LeadStatusOption[]>("/api/lead-statuses", refreshKey);
  const leads = useApi<Lead[]>("/api/leads", refreshKey);
  const matches = useApi<MatchCandidate[]>("/api/matches", refreshKey);
  const gdpr = useApi<GdprEntry[]>("/api/gdpr", refreshKey);
  const users = useApi<User[]>("/api/users", refreshKey);
  const campaigns = useApi<Campaign[]>("/api/campaigns", refreshKey);
  const savedCustomerMaps = useApi<SavedCustomerMap[]>("/api/customer-map/saved", refreshKey);
  const activityEvents = useActivityEvents(refreshKey, currentUserId);
  const [customerTest, setCustomerTest] = useState<CustomerTestState>({
    query: "",
    submittedQuery: "",
    state: { loading: false },
    persistToDatabase: false,
    regionId: ""
  });
  const [prospectTest, setProspectTest] = useState<ProspectTestState>({
    query: "",
    submittedQuery: "",
    state: { loading: false },
    mode: "live",
    detail: { loading: false },
    selectedProspectId: "",
    persistToDatabase: false
  });
  const [prospectTestCustomerContext, setProspectTestCustomerContext] = useState<ProspectTestCustomerContext | null>(null);
  const [prospectViewState, setProspectViewState] = useState<ProspectPageViewState>({
    searchText: "",
    searchDetails: false,
    addedFrom: "",
    addedTo: "",
    sortKey: "businessName",
    sortDirection: "asc"
  });
  const [customerViewState, setCustomerViewState] = useState<CustomerPageViewState>({
    searchText: "",
    postcodeText: "",
    regionId: "",
    customerActivityStatusId: "",
    customerValueTypeId: "",
    assignedUserId: "",
    onlyBookmarked: false,
    onlyMapped: false,
    onlyCancelled: true,
    onlyMatched: false,
    addedFrom: "",
    addedTo: "",
    sortKey: "entityName",
    sortDirection: "asc"
  });
  const [customerSelectedId, setCustomerSelectedId] = useState<number | null>(null);
  const [customerHighlightedId, setCustomerHighlightedId] = useState<number | null>(null);
  const [dashboardSelectedCustomerId, setDashboardSelectedCustomerId] = useState<number | null>(null);
  const [customerCleanseViewState, setCustomerCleanseViewState] = useState<CustomerPageViewState>({
    searchText: "",
    postcodeText: "",
    regionId: "",
    customerActivityStatusId: "",
    customerValueTypeId: "",
    assignedUserId: "",
    onlyBookmarked: false,
    onlyMapped: false,
    onlyCancelled: false,
    onlyMatched: false,
    addedFrom: "",
    addedTo: "",
    sortKey: "entityName",
    sortDirection: "asc"
  });
  const [regionAssignmentViewState, setRegionAssignmentViewState] = useState<CustomerPageViewState>({
    searchText: "",
    postcodeText: "",
    regionId: "",
    customerActivityStatusId: "",
    customerValueTypeId: "",
    assignedUserId: "",
    onlyBookmarked: false,
    onlyMapped: false,
    onlyCancelled: false,
    onlyMatched: false,
    addedFrom: "",
    addedTo: "",
    sortKey: "addedAt",
    sortDirection: "desc"
  });
  const [customerDedupeViewState, setCustomerDedupeViewState] = useState<CustomerPageViewState>({
    searchText: "",
    postcodeText: "",
    regionId: "",
    customerActivityStatusId: "",
    customerValueTypeId: "",
    assignedUserId: "",
    onlyBookmarked: false,
    onlyMapped: false,
    onlyCancelled: false,
    onlyMatched: false,
    addedFrom: "",
    addedTo: "",
    sortKey: "entityName",
    sortDirection: "asc"
  });
  const [customerMapViewState, setCustomerMapViewState] = useState<CustomerPageViewState>({
    searchText: "",
    postcodeText: "",
    regionId: "",
    customerActivityStatusId: "",
    customerValueTypeId: "",
    assignedUserId: "",
    onlyBookmarked: false,
    onlyMapped: false,
    onlyCancelled: true,
    onlyMatched: false,
    addedFrom: "",
    addedTo: "",
    sortKey: "entityName",
    sortDirection: "asc"
  });
  const [customerMapLoadRequest, setCustomerMapLoadRequest] = useState<number | null>(null);
  const [customerMapLeadRequest, setCustomerMapLeadRequest] = useState<Lead[] | null>(null);
  const [prospectCleanseViewState, setProspectCleanseViewState] = useState<ProspectPageViewState>({
    searchText: "",
    searchDetails: false,
    addedFrom: "",
    addedTo: "",
    sortKey: "businessName",
    sortDirection: "asc"
  });
  const [leadViewState, setLeadViewState] = useState<LeadViewState>({
    searchText: "",
    statusFilter: "all",
    priorityFilter: "all",
    assignedUserId: "",
    selectedCampaignId: "",
    selectedWaveId: "",
    sortKey: "createdAt",
    sortDirection: "desc"
  });
  const [gdprForm, setGdprForm] = useState<GdprFormState>({
    emailAddress: "",
    name: "",
    address: ""
  });
  const [userForm, setUserForm] = useState<UserFormState>({
    fullName: "",
    initials: "",
    phone: "",
    email: "",
    color: userColorOptions[0].value
  });
  const [regionForm, setRegionForm] = useState<RegionFormState>({
    name: ""
  });
  const [customerActivityStatusForm, setCustomerActivityStatusForm] = useState<CustomerActivityStatusFormState>({
    name: "",
    sortOrder: ""
  });
  const [leadStatusForm, setLeadStatusForm] = useState<LeadStatusFormState>({
    name: "",
    sortOrder: ""
  });
  const [geminiSettingsForm, setGeminiSettingsForm] = useState<GeminiSettingsState>({
    apiKey: ""
  });
  const [aiInsightContext, setAiInsightContext] = useState<AiInsightContext | null>(null);
  const [businessTypeForm, setBusinessTypeForm] = useState<BusinessTypeFormState>({
    name: "",
    sicCodeInput: ""
  });
  const [customerValueTypeForm, setCustomerValueTypeForm] = useState<CustomerValueTypeFormState>({
    label: "",
    decimalValue: ""
  });
  const [campaignForm, setCampaignForm] = useState<CampaignFormState>({
    name: "",
    description: "",
    objective: "",
    startDate: "",
    endDate: "",
    targetAudience: "",
    budget: "",
    productService: "",
    status: "Draft"
  });
  const [operationsCollapsed, setOperationsCollapsed] = useState(false);
  const viewScrollPositionsRef = useRef<Record<string, number>>({});
  const pendingScrollRestoreRef = useRef<{ view: string; top: number; attempts: number } | null>(null);
  const refreshData = () => setRefreshKey((current) => current + 1);
  const currentUser = (users.data ?? []).find((user) => String(user.id) === currentUserId) ?? null;

  useEffect(() => {
    window.localStorage.setItem(actorUserStorageKey, currentUserId);
  }, [currentUserId]);

  function navigateToView(nextView: string) {
    viewScrollPositionsRef.current[activeView] = window.scrollY;
    setActiveView(nextView);
  }

  function openProspectTestFromCustomerFilter(
    customer: Customer,
    filterField: ProspectTestCustomerContext["filterField"],
    filterValue?: string | null
  ) {
    setCustomerHighlightedId(null);
    const nextQuery = (filterValue ?? "").trim();
    setProspectTest((current) => ({
      ...current,
      query: nextQuery,
      submittedQuery: "",
      mode: "live",
      state: { loading: false },
      persistToDatabase: false,
      selectedProspectId: "",
      detail: { loading: false }
    }));
    setProspectTestCustomerContext({
      customerId: customer.id,
      customerRef: customer.customerRef,
      entityName: customer.entityName,
      tradingName: customer.tradingName,
      postcode: customer.postcode,
      filterField,
      filterValue: nextQuery
    });
    navigateToView("prospect-test");
  }

  function backToCustomersFromProspectImport() {
    navigateToView("customers");
    setCustomerSelectedId(null);
    setCustomerHighlightedId(prospectTestCustomerContext?.customerId ?? null);
  }

  function useProspectForCustomerFromProspectImport() {
    if (!prospectTestCustomerContext?.customerId) {
      navigateToView("customers");
      return;
    }

    setCustomerSelectedId(prospectTestCustomerContext.customerId);
    setCustomerHighlightedId(prospectTestCustomerContext.customerId);
    navigateToView("customers");
  }

  function openAiCompanyInsightForCustomer(customer: Pick<Customer, "id" | "entityName" | "tradingName" | "postcode">) {
    setAiInsightContext({
      customerId: customer.id,
      customerLabel: customer.entityName,
      tradingName: customer.tradingName,
      postcode: customer.postcode,
      sourceView: activeView === "dashboard" ? "dashboard" : "customers"
    });
    navigateToView("ai-company-insight");
  }

  function openCustomerFromLead(customerId: number) {
    setCustomerSelectedId(customerId);
    setCustomerHighlightedId(customerId);
    navigateToView("customers");
  }

  function returnFromAiCompanyInsight() {
    if (!aiInsightContext?.customerId) {
      navigateToView("customers");
      return;
    }

    if (aiInsightContext.sourceView === "dashboard") {
      setDashboardSelectedCustomerId(aiInsightContext.customerId);
      navigateToView("dashboard");
      return;
    }

    setCustomerSelectedId(aiInsightContext.customerId);
    setCustomerHighlightedId(aiInsightContext.customerId);
    navigateToView("customers");
  }

  useEffect(() => {
    pendingScrollRestoreRef.current = {
      view: activeView,
      top: viewScrollPositionsRef.current[activeView] ?? 0,
      attempts: 12
    };
  }, [activeView]);

  useEffect(() => {
    const pending = pendingScrollRestoreRef.current;
    if (!pending || pending.view !== activeView) {
      return;
    }

    let cancelled = false;
    const restore = () => {
      if (cancelled) {
        return;
      }

      const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      const targetTop = Math.min(pending.top, maxScroll);
      window.scrollTo({ top: targetTop, behavior: "auto" });

      const closeEnough = Math.abs(window.scrollY - targetTop) <= 2;
      pending.attempts -= 1;
      if (closeEnough || pending.attempts <= 0) {
        pendingScrollRestoreRef.current = null;
      }
    };

    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(restore);
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  });

  const primaryViews = useMemo(
    () => [
      { id: "dashboard", label: "Dashboard", icon: Activity },
      { id: "prospects", label: "Prospects", icon: Users },
      { id: "customers", label: "Customers", icon: Building2 },
      { id: "leads", label: "Leads", icon: BadgeCheck },
      { id: "campaigns", label: "Campaigns", icon: Megaphone },
      { id: "geography", label: "Geography", icon: MapPinned },
      { id: "ai-company-insight", label: "AI Company Insight", icon: CircleHelp },
      { id: "compliance", label: "Compliance", icon: CircleAlert }
    ],
    []
  );
  const operationsViews = useMemo(
    () => [
      { id: "customer-test", label: "Customer Import", icon: SearchCheck },
      { id: "prospect-test", label: "Prospect Import", icon: Users },
      { id: "regions", label: "Region Maintenance", icon: MapPinned },
      { id: "business-types", label: "Business Types", icon: Building2 },
      { id: "customer-value-types", label: "Customer Value Type", icon: BadgeCheck },
      { id: "ai-settings", label: "AI Settings", icon: CircleHelp },
      { id: "jobs", label: "Jobs", icon: Activity },
      { id: "customer-activity-statuses", label: "Customer Activity Status", icon: Activity },
      { id: "lead-statuses", label: "Lead Status", icon: BadgeCheck },
      { id: "region-assignment", label: "Region Assignment", icon: MapPinned },
      { id: "customer-dedupe", label: "Customer Dedupe", icon: GitCompareArrows },
      { id: "users", label: "Users", icon: Users },
      { id: "search-runs", label: "Search Runs", icon: Search },
      { id: "prospect-cleanse", label: "Prospect Cleanse", icon: Archive },
      { id: "customer-cleanse", label: "Customer Cleanse", icon: Archive },
      { id: "matches", label: "Matches", icon: GitCompareArrows }
    ],
    []
  );
  const views = useMemo(() => [...primaryViews, ...operationsViews], [operationsViews, primaryViews]);
  const activeTitle = activeView.startsWith("lead:")
    ? "Lead"
    : views.find((view) => view.id === activeView)?.label;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <Database size={24} aria-hidden />
          <div>
            <h1>Match Lab</h1>
            <span>Paymentsense data testing</span>
          </div>
        </div>

        <nav className="nav-list" aria-label="Primary">
          {primaryViews.map((view) => {
            const Icon = view.icon;
            return (
              <Fragment key={view.id}>
                <button
                  className={activeView === view.id ? "nav-item active" : "nav-item"}
                  onClick={() => {
                    if (view.id === "ai-company-insight") {
                      setAiInsightContext(null);
                    }
                    navigateToView(view.id);
                  }}
                  type="button"
                >
                  <Icon size={18} aria-hidden />
                  <span>{view.label}</span>
                </button>
                {view.id === "geography" && savedCustomerMaps.data?.length ? (
                  <div className="nav-sublist geography-saved-list">
                    {savedCustomerMaps.data.map((map) => (
                      <div className="saved-map-nav-row" key={map.id}>
                        <button
                          className={activeView === "geography" && customerMapLoadRequest === map.id ? "nav-item active" : "nav-item"}
                          onClick={() => {
                            setCustomerMapLoadRequest(map.id);
                            navigateToView("geography");
                          }}
                          type="button"
                          title={`${map.customerCount} customer${map.customerCount === 1 ? "" : "s"}`}
                        >
                          <MapPin size={15} aria-hidden />
                          <span>{map.name}</span>
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </Fragment>
            );
          })}

          <div className="nav-group">
            <button
              className="nav-group-label nav-group-toggle"
              onClick={() => setOperationsCollapsed((current) => !current)}
              type="button"
            >
              <Search size={16} aria-hidden />
              {operationsCollapsed ? <ChevronRight size={16} aria-hidden /> : <ChevronDown size={16} aria-hidden />}
              <span>Operations</span>
            </button>
            {!operationsCollapsed && (
              <div className="nav-sublist">
                {operationsViews.map((view) => {
                  const Icon = view.icon;
                  return (
                    <button
                      key={view.id}
                      className={activeView === view.id ? "nav-item nav-subitem active" : "nav-item nav-subitem"}
                      onClick={() => navigateToView(view.id)}
                      type="button"
                    >
                      <Icon size={18} aria-hidden />
                      <span>{view.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </nav>

      </aside>

      <main className={activeView === "geography" ? "workspace workspace-geography" : "workspace"}>
        <header className="topbar">
          <div>
            <p className="eyebrow">Manual Test Workspace</p>
            <h2>{activeTitle}</h2>
          </div>
          <div className="topbar-actions">
            <label className="topbar-user">
              <span>Current user</span>
              <select
                className="header-select"
                value={currentUserId}
                onChange={(event) => setCurrentUserId(event.target.value)}
              >
                <option value="">Unknown</option>
                {(users.data ?? []).map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.fullName}
                  </option>
                ))}
              </select>
            </label>
            <ApiStatus />
          </div>
        </header>

        {activeView === "dashboard" && (
          <DashboardView
            state={dashboard}
            activityState={activityEvents.state}
            leads={leads.data ?? []}
            customers={customers.data ?? []}
            users={users.data ?? []}
            customerActivityStatuses={customerActivityStatuses.data ?? []}
            customerValueTypes={customerValueTypes.data ?? []}
            leadStatuses={leadStatuses.data ?? []}
            currentUser={currentUser}
            currentUserId={currentUserId}
            selectedUserId={currentUserId}
            onSelectedUserIdChange={setCurrentUserId}
            onOpenProspectTest={openProspectTestFromCustomerFilter}
            onOpenLead={(leadId) => navigateToView(`lead:${leadId}`)}
            onOpenAiCompanyInsight={openAiCompanyInsightForCustomer}
            onDataChanged={refreshData}
            selectedCustomerId={dashboardSelectedCustomerId}
            onSelectedCustomerIdChange={setDashboardSelectedCustomerId}
          />
        )}
        {activeView === "customer-test" && (
          <CustomerTestView
            value={customerTest}
            onChange={setCustomerTest}
            onDataChanged={refreshData}
            regions={regions.data ?? []}
            customers={customers.data ?? []}
          />
        )}
        {activeView === "prospect-test" && (
          <ProspectTestView
            value={prospectTest}
            onChange={setProspectTest}
            onDataChanged={refreshData}
            customerContext={prospectTestCustomerContext}
            onBackToCustomers={backToCustomersFromProspectImport}
            onUseProspectForCustomer={useProspectForCustomerFromProspectImport}
          />
        )}
        {activeView === "users" && (
          <UsersView
            state={users}
            form={userForm}
            onFormChange={setUserForm}
            onDataChanged={refreshData}
          />
        )}
        {activeView === "regions" && (
          <RegionsView
            state={regions}
            form={regionForm}
            onFormChange={setRegionForm}
            onDataChanged={refreshData}
          />
        )}
        {activeView === "business-types" && (
          <BusinessTypesView
            state={businessTypes}
            sicCodes={companySicCodes.data ?? []}
            form={businessTypeForm}
            onFormChange={setBusinessTypeForm}
            onDataChanged={refreshData}
          />
        )}
        {activeView === "customer-value-types" && (
          <CustomerValueTypesView
            state={customerValueTypes}
            form={customerValueTypeForm}
            onFormChange={setCustomerValueTypeForm}
            onDataChanged={refreshData}
          />
        )}
        {activeView === "customer-activity-statuses" && (
          <CustomerActivityStatusesView
            state={customerActivityStatuses}
            form={customerActivityStatusForm}
            onFormChange={setCustomerActivityStatusForm}
            onDataChanged={refreshData}
          />
        )}
        {activeView === "lead-statuses" && (
          <LeadStatusesView
            state={leadStatuses}
            form={leadStatusForm}
            onFormChange={setLeadStatusForm}
            onDataChanged={refreshData}
          />
        )}
        {activeView === "ai-settings" && (
          <AiSettingsView
            form={geminiSettingsForm}
            onFormChange={setGeminiSettingsForm}
          />
        )}
        {activeView === "jobs" && <JobsView />}
        {activeView === "search-runs" && <SearchRunsView state={searchRuns} />}
        {activeView === "ai-company-insight" && (
          <AiCompanyInsightView
            state={aiCompanyInsights}
            onDataChanged={refreshData}
            context={aiInsightContext}
            onBackToCustomer={returnFromAiCompanyInsight}
            onOpenJobs={() => navigateToView("jobs")}
          />
        )}
        {activeView === "prospects" && (
          <ProspectsView
            state={prospects}
            onDataChanged={refreshData}
            viewState={prospectViewState}
            onViewStateChange={setProspectViewState}
          />
        )}
        {activeView === "customers" && (
          <CustomersView
            state={customers}
            regions={regions.data ?? []}
            customerActivityStatuses={customerActivityStatuses.data ?? []}
            customerValueTypes={customerValueTypes.data ?? []}
            users={users.data ?? []}
            currentUser={currentUser}
            currentUserId={currentUserId}
            viewState={customerViewState}
            onViewStateChange={setCustomerViewState}
            onOpenProspectTest={openProspectTestFromCustomerFilter}
            onOpenLead={(leadId) => navigateToView(`lead:${leadId}`)}
            onOpenAiCompanyInsight={openAiCompanyInsightForCustomer}
            onDataChanged={refreshData}
            selectedCustomerId={customerSelectedId}
            highlightedCustomerId={customerHighlightedId}
            onHighlightedCustomerIdChange={setCustomerHighlightedId}
            onSelectedCustomerIdChange={setCustomerSelectedId}
          />
        )}
        {activeView === "customer-dedupe" && (
          <CustomersView
            state={customers}
            regions={regions.data ?? []}
            customerActivityStatuses={customerActivityStatuses.data ?? []}
            customerValueTypes={customerValueTypes.data ?? []}
            users={users.data ?? []}
            currentUser={currentUser}
            currentUserId={currentUserId}
            viewState={customerDedupeViewState}
            onViewStateChange={setCustomerDedupeViewState}
            onOpenProspectTest={openProspectTestFromCustomerFilter}
            onOpenLead={(leadId) => navigateToView(`lead:${leadId}`)}
            onOpenAiCompanyInsight={openAiCompanyInsightForCustomer}
            onDataChanged={refreshData}
            selectedCustomerId={customerSelectedId}
            highlightedCustomerId={customerHighlightedId}
            onHighlightedCustomerIdChange={setCustomerHighlightedId}
            onSelectedCustomerIdChange={setCustomerSelectedId}
            duplicateMode
            allowListOptionsToggle={false}
          />
        )}
        {activeView === "prospect-cleanse" && (
          <ProspectCleanseView
            state={prospects}
            viewState={prospectCleanseViewState}
            onViewStateChange={setProspectCleanseViewState}
            onDataChanged={refreshData}
          />
        )}
        {activeView === "customer-cleanse" && (
          <CustomerCleanseView
            state={customers}
            regions={regions.data ?? []}
            viewState={customerCleanseViewState}
            onViewStateChange={setCustomerCleanseViewState}
            onDataChanged={refreshData}
          />
        )}
        {activeView === "region-assignment" && (
          <RegionAssignmentView
            state={customers}
            regions={regions.data ?? []}
            viewState={regionAssignmentViewState}
            onViewStateChange={setRegionAssignmentViewState}
            onDataChanged={refreshData}
          />
        )}
        {activeView === "leads" && (
          <LeadsView
            state={leads}
            users={users.data ?? []}
            campaigns={campaigns.data ?? []}
            leadStatuses={leadStatuses.data ?? []}
            onOpenLead={(leadId) => navigateToView(`lead:${leadId}`)}
            onRemoveLead={() => refreshData()}
            viewState={leadViewState}
            onViewStateChange={setLeadViewState}
            onOpenSelectedLeadsMap={(leadRows) => {
              setCustomerMapLeadRequest(leadRows);
              navigateToView("geography");
            }}
          />
        )}
        {activeView.startsWith("lead:") && (
          <LeadDetailView
            leadId={Number(activeView.split(":")[1])}
            onBack={() => navigateToView("leads")}
            onOpenCustomer={openCustomerFromLead}
            onLeadChanged={refreshData}
            users={users.data ?? []}
            leadStatuses={leadStatuses.data ?? []}
            customerValueTypes={customerValueTypes.data ?? []}
            defaultUserId={currentUserId}
          />
        )}
        {activeView === "campaigns" && (
          <CampaignsView
            state={campaigns}
            form={campaignForm}
            onFormChange={setCampaignForm}
            leadStatuses={leadStatuses.data ?? []}
            onDataChanged={refreshData}
          />
        )}
        {activeView === "geography" && (
          <CustomerGeographyView
            regions={regions.data ?? []}
            customerActivityStatuses={customerActivityStatuses.data ?? []}
            customerValueTypes={customerValueTypes.data ?? []}
            users={users.data ?? []}
            viewState={customerMapViewState}
            onViewStateChange={setCustomerMapViewState}
            savedMapIdToLoad={customerMapLoadRequest}
            onSavedMapLoaded={() => setCustomerMapLoadRequest(null)}
            leadRowsToLoad={customerMapLeadRequest}
            onLeadRowsLoaded={() => setCustomerMapLeadRequest(null)}
            onSavedMapsChanged={refreshData}
          />
        )}
        {activeView === "compliance" && (
          <ComplianceView
            state={gdpr}
            form={gdprForm}
            onFormChange={setGdprForm}
            onDataChanged={refreshData}
          />
        )}
        {activeView === "matches" && <MatchesView state={matches} />}
        <ToastStack
          events={activityEvents.toasts}
          currentUserName={currentUser?.fullName}
          onDismiss={activityEvents.dismissToast}
        />
      </main>
    </div>
  );
}

function CustomerTestView({
  value,
  onChange,
  onDataChanged,
  regions,
  customers
}: {
  value: CustomerTestState;
  onChange: Dispatch<SetStateAction<CustomerTestState>>;
  onDataChanged: () => void;
  regions: Region[];
  customers: Customer[];
}) {
  async function runLiveSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runSearch("live");
  }

  async function runSearch(nextMode: SearchMode = "live") {
    const trimmed = value.query.trim();
    onChange((current) => ({
      ...current,
      submittedQuery: trimmed,
      state: { loading: true }
    }));

    try {
      const response = await fetchWithActor(`${apiBase}/api/test/customer-search/live`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: trimmed,
          persistToDatabase: value.persistToDatabase,
          regionId: value.regionId ? Number(value.regionId) : null
        })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as CustomerSearchPreview;
      onChange((current) => ({ ...current, state: { data, loading: false } }));
      if (value.persistToDatabase) {
        onDataChanged();
      }
    } catch (error) {
      onChange((current) => ({
        ...current,
        state: {
          error: error instanceof Error ? error.message : "Could not load customer search preview.",
          loading: false
        }
      }));
    }
  }

  return (
    <section className="test-page">
      <form className="search-form" onSubmit={runLiveSearch}>
        <label htmlFor="customer-search-query">Search term</label>
        <label className="header-filter">
          <input
            type="checkbox"
            checked={value.persistToDatabase}
            onChange={(event) => onChange((current) => ({ ...current, persistToDatabase: event.target.checked }))}
          />
          <span>Add all to database</span>
        </label>
        <div className="search-row">
          <input
            id="customer-search-query"
            type="search"
            value={value.query}
            onChange={(event) => onChange((current) => ({ ...current, query: event.target.value }))}
            placeholder="Business name, MID, customer ref, postcode"
          />
          <button type="submit">
            <SearchCheck size={17} aria-hidden />
            <span>Extract Live</span>
          </button>
        </div>
        <div className="table-search table-search-compact">
          <label htmlFor="customer-region-select">Region</label>
          <select
            id="customer-region-select"
            value={value.regionId}
            onChange={(event) => onChange((current) => ({ ...current, regionId: event.target.value }))}
          >
            <option value="">No region</option>
            {regions.map((region) => (
              <option key={region.id} value={region.id}>
                {region.name}
              </option>
            ))}
          </select>
        </div>
      </form>

      <div className="url-preview">
        <span>Search URL</span>
        <code>https://search.paymentsense.com/?query={encodeURIComponent(value.query.trim())}</code>
      </div>

      {!value.submittedQuery && <EmptyPanel message="Enter the customer search term, then extract live rows from Paymentsense Search." />}

      {value.submittedQuery && value.state.loading && <PanelSkeleton />}
      {value.submittedQuery && value.state.error && <ErrorPanel error={value.state.error} />}
      {value.submittedQuery && value.state.data && (
        <CustomerSearchResults
          mode={nextCustomerSearchMode(value.state.data)}
          preview={value.state.data}
          persistToDatabase={value.persistToDatabase}
          selectedRegionId={value.regionId}
          customers={customers}
          onDataChanged={onDataChanged}
          onChange={onChange}
        />
      )}
    </section>
  );
}

function nextCustomerSearchMode(preview?: CustomerSearchPreview): SearchMode {
  return preview?.searchUrl?.includes("paymentsense.com") ? "live" : "stored";
}

function ProspectTestView({
  value,
  onChange,
  onDataChanged,
  customerContext,
  onBackToCustomers,
  onUseProspectForCustomer
}: {
  value: ProspectTestState;
  onChange: Dispatch<SetStateAction<ProspectTestState>>;
  onDataChanged: () => void;
  customerContext: ProspectTestCustomerContext | null;
  onBackToCustomers: () => void;
  onUseProspectForCustomer: () => void;
}) {
  const [sortKey, setSortKey] = useState<ProspectTestSortKey>("prospectId");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const attemptedCachedSearchRef = useRef<string>("");
  const [usingCurrentProspect, setUsingCurrentProspect] = useState(false);

  async function runLiveSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runSearch("live");
  }

  async function runSearch(nextMode: SearchMode) {
    const trimmed = value.query.trim();
    onChange((current) => ({
      ...current,
      submittedQuery: trimmed,
      mode: nextMode,
      state: { loading: true }
    }));

    try {
      const response = nextMode === "live"
        ? await fetchWithActor(`${apiBase}/api/test/prospect-search/live`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: trimmed, persistToDatabase: value.persistToDatabase })
          })
        : await fetchWithActor(`${apiBase}/api/test/prospect-search?query=${encodeURIComponent(trimmed)}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as ProspectSearchPreview;
      onChange((current) => ({
        ...current,
        selectedProspectId: "",
        detail: { loading: false },
        state: { data, loading: false }
      }));
      if (nextMode === "live" && value.persistToDatabase) {
        onDataChanged();
      }
    } catch (error) {
      onChange((current) => ({
        ...current,
        selectedProspectId: "",
        detail: { loading: false },
        state: {
          error: error instanceof Error ? error.message : "Could not load prospect search preview.",
          loading: false
        }
      }));
    }
  }

  async function loadSavedSearch(query: string) {
    onChange((current) => ({
      ...current,
      submittedQuery: query,
      mode: "stored",
      selectedProspectId: "",
      detail: { loading: false },
      state: { loading: true }
    }));

    try {
      const response = await fetchWithActor(`${apiBase}/api/test/prospect-search/cache?query=${encodeURIComponent(query)}`);
      if (response.status === 404) {
        onChange((current) => ({
          ...current,
          submittedQuery: "",
          state: { loading: false },
          selectedProspectId: "",
          detail: { loading: false }
        }));
        return;
      }

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as ProspectSearchPreview;
      onChange((current) => ({
        ...current,
        selectedProspectId: "",
        detail: { loading: false },
        mode: "stored",
        state: { data, loading: false }
      }));
    } catch (error) {
      onChange((current) => ({
        ...current,
        submittedQuery: "",
        selectedProspectId: "",
        detail: { loading: false },
        state: {
          error: error instanceof Error ? error.message : "Could not load saved prospect search.",
          loading: false
        }
      }));
    }
  }

  useEffect(() => {
    if (!customerContext) {
      attemptedCachedSearchRef.current = "";
      return;
    }

    const trimmedQuery = value.query.trim();
    const contextQuery = customerContext.filterValue.trim();
    if (!trimmedQuery || trimmedQuery !== contextQuery) {
      return;
    }

    const cacheKey = `${customerContext.customerId}:${contextQuery.toLowerCase()}`;
    if (attemptedCachedSearchRef.current === cacheKey) {
      return;
    }

    attemptedCachedSearchRef.current = cacheKey;
    void loadSavedSearch(contextQuery);
  }, [customerContext, value.query]);

  async function loadProspectDetail(prospectId: string) {
    if (value.selectedProspectId === prospectId && !value.detail.loading) {
      onChange((current) => ({
        ...current,
        selectedProspectId: "",
        detail: { loading: false }
      }));
      return;
    }

    onChange((current) => ({
      ...current,
      selectedProspectId: prospectId,
      detail: { loading: true }
    }));

    try {
      const response = await fetchWithActor(`${apiBase}/api/test/prospect-detail/${encodeURIComponent(prospectId)}?persist=false`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as ProspectDetail;
      onChange((current) => ({
        ...current,
        detail: { data, loading: false },
        state: current.state.data
          ? {
              data: {
                ...current.state.data,
                rows: current.state.data.rows
              },
              loading: false
            }
          : current.state
      }));
    } catch (error) {
      onChange((current) => ({
        ...current,
        detail: {
          error: error instanceof Error ? error.message : "Could not load prospect detail.",
          loading: false
        }
      }));
    }
  }

  function handleSort(nextKey: ProspectTestSortKey) {
    if (sortKey === nextKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(nextKey);
    setSortDirection("asc");
  }

  async function useCurrentProspectForCustomer() {
    if (!customerContext?.customerId || !value.selectedProspectId || !value.state.data?.rows.length) {
      return;
    }

    const selectedRow = value.state.data.rows.find((row) => row.prospectId === value.selectedProspectId);
    if (!selectedRow) {
      return;
    }

    setUsingCurrentProspect(true);
    try {
      const response = await fetchWithActor(`${apiBase}/api/customers/${customerContext.customerId}/prospects/use`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prospectId: selectedRow.prospectId,
          businessName: selectedRow.businessName,
          contactName: selectedRow.contactName,
          contactEmail: selectedRow.contactEmail,
          createdOn: selectedRow.createdOn,
          ownerName: selectedRow.ownerName,
          sourceUrl: selectedRow.sourceUrl
        })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? `HTTP ${response.status}`);
      }

      onDataChanged();
      onUseProspectForCustomer();
    } finally {
      setUsingCurrentProspect(false);
    }
  }

  return (
    <section className="test-page">
      {customerContext && (
        <div className="page-actions">
          <button className="secondary-action" type="button" onClick={onBackToCustomers}>
            Back to Customers
          </button>
        </div>
      )}
      <form className="search-form" onSubmit={runLiveSearch}>
        <label htmlFor="prospect-search-query">Search term</label>
        <label className="header-filter">
          <input
            type="checkbox"
            checked={value.persistToDatabase}
            onChange={(event) => onChange((current) => ({ ...current, persistToDatabase: event.target.checked }))}
          />
          <span>Add all to database</span>
        </label>
        <div className="search-row">
          <input
            id="prospect-search-query"
            type="search"
            value={value.query}
            onChange={(event) => onChange((current) => ({ ...current, query: event.target.value }))}
            placeholder="Business name, prospect ID, contact, email"
          />
          <button type="submit" disabled={value.state.loading || value.detail.loading}>
            <SearchCheck size={17} aria-hidden />
            <span>{value.state.loading && value.mode === "live" ? "Extracting..." : "Extract Live"}</span>
          </button>
        </div>
      </form>

      <div className="url-preview">
        <span>Search URL</span>
        <code>https://search.paymentsense.com/?query={encodeURIComponent(value.query.trim())}</code>
      </div>

      {customerContext && value.query.trim() === customerContext.filterValue && (
        <StatusBanner
          kind="success"
          message={`Customer context active: ${customerContext.entityName}${customerContext.tradingName ? ` / ${customerContext.tradingName}` : ""}${customerContext.postcode ? ` / ${customerContext.postcode}` : ""}`}
        />
      )}
      {customerContext && value.state.data?.savedSearchUsed && (
        <div className="page-actions">
          <span className="status-pill">
            Saved search
            {value.state.data.cachedAt ? ` from ${formatDateTime(value.state.data.cachedAt)}` : ""}
          </span>
          <button
            className="secondary-action"
            type="button"
            disabled={value.state.loading || value.detail.loading}
            onClick={() => void runSearch("live")}
          >
            Refresh
          </button>
        </div>
      )}

      {!value.submittedQuery && (
        <EmptyPanel message="Enter the prospect search term, then extract live rows from Paymentsense Search." />
      )}

      {value.submittedQuery && value.state.loading && <PanelSkeleton />}
      {value.submittedQuery && value.state.error && <ErrorPanel error={value.state.error} />}
      {value.submittedQuery && value.state.data && (
        <ProspectSearchResults
          mode={value.mode}
          preview={value.state.data}
          customerContext={customerContext}
          selectedProspectId={value.selectedProspectId}
          detailState={value.detail}
          usingCurrentProspect={usingCurrentProspect}
          onUseCurrentProspect={
            customerContext && value.detail.data && value.selectedProspectId
              ? () => void useCurrentProspectForCustomer()
              : undefined
          }
          sortKey={sortKey}
          sortDirection={sortDirection}
          onSort={handleSort}
          onSelect={loadProspectDetail}
          onDataChanged={onDataChanged}
          onChange={onChange}
        />
      )}
      {value.submittedQuery && value.mode === "live" && !value.state.loading && value.state.data && (
        <StatusBanner kind="success" message={`Loaded ${value.state.data.rows.length} live prospect rows from Paymentsense Search.`} />
      )}
    </section>
  );
}

function CustomerSearchResults({
  mode,
  preview,
  persistToDatabase,
  selectedRegionId,
  customers,
  onDataChanged,
  onChange
}: {
  mode: "live" | "stored";
  preview: CustomerSearchPreview;
  persistToDatabase: boolean;
  selectedRegionId: string;
  customers: Customer[];
  onDataChanged: () => void;
  onChange: Dispatch<SetStateAction<CustomerTestState>>;
}) {
  const [selectedRowKeys, setSelectedRowKeys] = useState<Set<string>>(() => new Set());
  const [importingCurrent, setImportingCurrent] = useState(false);
  const [findingCurrent, setFindingCurrent] = useState(false);
  const [notice, setNotice] = useState<ArchiveNotice | null>(null);
  const [showMatchesModal, setShowMatchesModal] = useState(false);
  const [currentMatches, setCurrentMatches] = useState<CustomerImportMatchResult[]>([]);
  const [textFilters, setTextFilters] = useState<string[]>([""]);
  const [filters, setFilters] = useState({
    onlyCancelled: false,
    onlyNotInDatabase: false,
    onlyMatchedCurrent: false
  });

  useEffect(() => {
    setSelectedRowKeys(new Set());
    setNotice(null);
    setCurrentMatches([]);
    setShowMatchesModal(false);
    setTextFilters([""]);
    setFilters({
      onlyCancelled: false,
      onlyNotInDatabase: false,
      onlyMatchedCurrent: false
    });
  }, [mode, preview.query, preview.searchUrl]);

  const matchResultsByKey = new Map(currentMatches.map((match) => [match.rowKey, match]));
  const visibleRows = preview.rows.filter((row) => {
    if (filters.onlyCancelled && !row.status?.toLowerCase().startsWith("cancel")) {
      return false;
    }
    if (filters.onlyNotInDatabase && row.added) {
      return false;
    }
    if (filters.onlyMatchedCurrent && !matchResultsByKey.has(getCustomerSearchRowKey(row))) {
      return false;
    }

    const activeTextFilters = textFilters
      .map((filter) => filter.trim())
      .filter(Boolean)
      .map((filter) => normalizeMatchText(filter));
    if (
      activeTextFilters.length > 0 &&
      !activeTextFilters.every((filter) =>
        getCustomerSearchRowFilterText(row).includes(filter)
      )
    ) {
      return false;
    }
    return true;
  });
  const selectedVisibleRows = visibleRows.filter((row) => selectedRowKeys.has(getCustomerSearchRowKey(row)));
  const allVisibleSelected = visibleRows.length > 0 && visibleRows.every((row) => selectedRowKeys.has(getCustomerSearchRowKey(row)));

  function setRowAddedState(rowKeys: string[], added: boolean) {
    const rowKeySet = new Set(rowKeys);
    onChange((current) => ({
      ...current,
      state: current.state.data
        ? {
            data: {
              ...current.state.data,
              rows: current.state.data.rows.map((currentRow) =>
                rowKeySet.has(getCustomerSearchRowKey(currentRow))
                  ? { ...currentRow, added }
                  : currentRow
              )
            },
            loading: false
          }
        : current.state
    }));
  }

  async function insertRow(row: CustomerSearchRow, shouldRefresh = true) {
    const rowKey = getCustomerSearchRowKey(row);
    const response = await fetchWithActor(`${apiBase}/api/test/customer-row/insert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerRef: row.customerRef,
        entity: row.entity,
        mid: row.mid,
        tradingName: row.tradingName,
        tradingAddress: row.tradingAddress,
        tradingPostcode: row.tradingPostcode,
        startDate: row.startDate,
        status: row.status,
        sourceUrl: row.sourceUrl,
        regionId: selectedRegionId ? Number(selectedRegionId) : null
      })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    setRowAddedState([rowKey], true);
    if (shouldRefresh) {
      onDataChanged();
    }
  }

  async function removeRow(row: CustomerSearchRow, shouldRefresh = true) {
    const rowKey = getCustomerSearchRowKey(row);
    const response = await fetchWithActor(`${apiBase}/api/test/customer-row/remove`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerRef: row.customerRef,
        entity: row.entity,
        mid: row.mid,
        tradingName: row.tradingName,
        tradingAddress: row.tradingAddress,
        tradingPostcode: row.tradingPostcode,
        startDate: row.startDate,
        status: row.status,
        sourceUrl: row.sourceUrl,
        regionId: selectedRegionId ? Number(selectedRegionId) : null
      })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    setRowAddedState([rowKey], false);
    if (shouldRefresh) {
      onDataChanged();
    }
  }

  async function importCurrent() {
    const targets = selectedVisibleRows.filter((row) => !row.added);
    if (!targets.length) {
      setNotice({ kind: "error", message: "No selected rows are ready to import." });
      return;
    }

    setImportingCurrent(true);
    setNotice(null);
    let successCount = 0;
    let failedCount = 0;

    for (const row of targets) {
      try {
        await insertRow(row, false);
        successCount += 1;
      } catch {
        failedCount += 1;
      }
    }

    if (successCount > 0) {
      onDataChanged();
    }
    setNotice({
      kind: failedCount ? "error" : "success",
      message: failedCount
        ? `Imported ${successCount} selected rows, ${failedCount} failed.`
        : `Imported ${successCount} selected rows.`
    });
    setImportingCurrent(false);
  }

  function toggleSelectAllVisible(checked: boolean) {
    setSelectedRowKeys((current) => {
      const next = new Set(current);
      for (const row of visibleRows) {
        const rowKey = getCustomerSearchRowKey(row);
        if (checked) next.add(rowKey);
        else next.delete(rowKey);
      }
      return next;
    });
  }

  function toggleRowSelection(row: CustomerSearchRow, checked: boolean) {
    const rowKey = getCustomerSearchRowKey(row);
    setSelectedRowKeys((current) => {
      const next = new Set(current);
      if (checked) next.add(rowKey);
      else next.delete(rowKey);
      return next;
    });
  }

  async function findCurrent() {
    setFindingCurrent(true);
    setNotice(null);
    const matches = preview.rows
      .map((row) => getCurrentCustomerImportMatch(row, customers))
      .filter((match): match is CustomerImportMatchResult => match !== null);
    setCurrentMatches(matches);
    setFindingCurrent(false);
    setNotice({
      kind: "success",
      message: matches.length
        ? `Found current customer matches for ${matches.length} extracted rows.`
        : "No current customer matches found in the extracted rows."
    });
  }

  if (!preview.rows.length) {
    return <EmptyPanel message={`No customer rows found for "${preview.query}" ${mode === "live" ? "from the live site" : "in stored data"}.`} />;
  }

  return (
    <section className="table-wrap">
      <div className="customer-import-toolbar">
        <div className="table-caption">
          <strong>{visibleRows.length}</strong>
          <span> {mode === "live" ? "live extracted" : "stored"} customer row{preview.rows.length === 1 ? "" : "s"}</span>
          {visibleRows.length !== preview.rows.length && <span className="filter-note"> filtered from {preview.rows.length}</span>}
        </div>
        <div className="row-actions">
          {!persistToDatabase && (
            <button
              className="page-action-button"
              type="button"
              disabled={!selectedVisibleRows.length || importingCurrent}
              onClick={() => void importCurrent()}
            >
              {importingCurrent ? "Importing..." : "Import Current"}
            </button>
          )}
          {mode === "live" && (
            <button
              className="secondary-action"
              type="button"
              disabled={findingCurrent}
              onClick={() => void findCurrent()}
            >
              {findingCurrent ? "Finding..." : "Find Current"}
            </button>
          )}
          <button
            className="secondary-action"
            type="button"
            disabled={!currentMatches.length}
            onClick={() => setShowMatchesModal(true)}
          >
            Show Matches
          </button>
        </div>
      </div>
      <div className="customer-import-filters">
        <div className="customer-import-filter-list">
          {textFilters.map((filter, index) => (
            <div key={`customer-import-filter-${index}`} className="customer-import-filter-row">
              <div className="table-search customer-import-filter-input">
                <label htmlFor={`customer-import-filter-${index}`}>Search filter {index + 1}</label>
                <input
                  id={`customer-import-filter-${index}`}
                  type="search"
                  value={filter}
                  onChange={(event) =>
                    setTextFilters((current) => current.map((value, valueIndex) => (valueIndex === index ? event.target.value : value)))
                  }
                  placeholder="Entity, trading name, address, postcode, MID"
                />
              </div>
              <div className="row-actions row-actions-inline">
                {index === textFilters.length - 1 && (
                  <button
                    className="secondary-action icon-button-text"
                    type="button"
                    onClick={() => setTextFilters((current) => [...current, ""])}
                  >
                    +
                  </button>
                )}
                {textFilters.length > 1 && (
                  <button
                    className="secondary-action icon-button-text"
                    type="button"
                    onClick={() =>
                      setTextFilters((current) => current.filter((_, valueIndex) => valueIndex !== index))
                    }
                  >
                    -
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        <label className="header-filter">
          <input
            type="checkbox"
            checked={filters.onlyCancelled}
            onChange={(event) => setFilters((current) => ({ ...current, onlyCancelled: event.target.checked }))}
          />
          <span>Cancelled only</span>
        </label>
        <label className="header-filter">
          <input
            type="checkbox"
            checked={filters.onlyNotInDatabase}
            onChange={(event) => setFilters((current) => ({ ...current, onlyNotInDatabase: event.target.checked }))}
          />
          <span>Not in DB</span>
        </label>
        <label className="header-filter">
          <input
            type="checkbox"
            checked={filters.onlyMatchedCurrent}
            onChange={(event) => setFilters((current) => ({ ...current, onlyMatchedCurrent: event.target.checked }))}
          />
          <span>Current matches</span>
        </label>
      </div>
      {notice && <StatusBanner kind={notice.kind} message={notice.message} />}
      <div className="table-caption">
        {!persistToDatabase && (
          <span>
            <strong>{selectedVisibleRows.length}</strong> selected in current view
          </span>
        )}
      </div>
      <table>
        <thead>
          <tr>
            {!persistToDatabase && (
              <th>
                <label className="header-filter">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={(event) => toggleSelectAllVisible(event.target.checked)}
                  />
                  <span>Select</span>
                </label>
              </th>
            )}
            <th>DB</th>
            <th>Customer ref</th>
            <th>Entity</th>
            <th>MID</th>
            <th>Trading name</th>
            <th>Trading address</th>
            <th>Postcode</th>
            <th>Start date</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row, index) => (
            <tr
              key={`${row.customerRef ?? row.mid ?? row.entity}-${index}`}
              className={matchResultsByKey.has(getCustomerSearchRowKey(row)) ? "customer-import-match-row" : undefined}
            >
              {!persistToDatabase && (
                <td>
                  <input
                    className="row-select-checkbox"
                    type="checkbox"
                    checked={selectedRowKeys.has(getCustomerSearchRowKey(row))}
                    onChange={(event) => toggleRowSelection(row, event.target.checked)}
                    aria-label={`Select ${row.entity}`}
                  />
                </td>
              )}
              <td>
                <button
                  className="details-button"
                  type="button"
                  onClick={() => void (row.added ? removeRow(row) : insertRow(row))}
                >
                  {row.added ? "Remove" : "Add"}
                </button>
              </td>
              <td className="mono">{row.customerRef ?? ""}</td>
              <td>{row.entity}</td>
              <td className="mono">{row.mid ?? ""}</td>
              <td>{row.tradingName ?? ""}</td>
              <td>{formatAddress(row)}</td>
              <td className="mono">{row.tradingPostcode ?? ""}</td>
              <td>{row.startDate ?? ""}</td>
              <td>{row.status ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <CustomerImportMatchesModal
        open={showMatchesModal}
        matches={currentMatches}
        onClose={() => setShowMatchesModal(false)}
      />
    </section>
  );
}

function ProspectSearchResults({
  mode,
  preview,
  customerContext,
  selectedProspectId,
  detailState,
  usingCurrentProspect,
  onUseCurrentProspect,
  sortKey,
  sortDirection,
  onSort,
  onSelect,
  onDataChanged,
  onChange
}: {
  mode: SearchMode;
  preview: ProspectSearchPreview;
  customerContext: ProspectTestCustomerContext | null;
  selectedProspectId: string;
  detailState: LoadState<ProspectDetail>;
  usingCurrentProspect?: boolean;
  onUseCurrentProspect?: () => void;
  sortKey: ProspectTestSortKey;
  sortDirection: SortDirection;
  onSort: (key: ProspectTestSortKey) => void;
  onSelect: (prospectId: string) => void;
  onDataChanged: () => void;
  onChange: Dispatch<SetStateAction<ProspectTestState>>;
}) {
  const [filterText, setFilterText] = useState("");

  if (!preview.rows.length) {
    return <EmptyPanel message={`No prospect rows found for "${preview.query}" ${mode === "live" ? "from the live site" : "in stored data"}.`} />;
  }

  const filteredRows = preview.rows.filter((row) => {
    const query = filterText.trim().toLowerCase();
    if (!query) return true;

    return [row.businessName, row.contactName, row.postcode]
      .filter(Boolean)
      .some((value) => value!.toLowerCase().includes(query));
  });

  const sortedRows = [...filteredRows].sort((left, right) =>
    compareValues(getProspectTestSortValue(left, sortKey), getProspectTestSortValue(right, sortKey), sortDirection)
  );

  async function insertRow(row: ProspectSearchRow) {
    const cachedDetail =
      selectedProspectId === row.prospectId && detailState.data?.prospectId === row.prospectId
        ? detailState.data
        : undefined;
    const response = await fetchWithActor(`${apiBase}/api/test/prospect-row/insert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prospectId: row.prospectId,
        businessName: row.businessName,
        contactName: row.contactName,
        contactEmail: row.contactEmail,
        createdOn: row.createdOn,
        ownerName: row.ownerName,
        sourceUrl: row.sourceUrl,
        detail: cachedDetail
          ? {
              businessName: cachedDetail.businessName,
              channel: cachedDetail.channel,
              origin: cachedDetail.origin,
              createdOn: cachedDetail.createdOn,
              hasPaymentsenseCustomerMatch: cachedDetail.hasPaymentsenseCustomerMatch,
              address: cachedDetail.address,
              contact: cachedDetail.contact
            }
          : undefined
      })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    onChange((current) => ({
      ...current,
      state: current.state.data
        ? {
            data: {
              ...current.state.data,
              rows: current.state.data.rows.map((currentRow) =>
                currentRow.prospectId === row.prospectId ? { ...currentRow, added: true } : currentRow
              )
            },
            loading: false
          }
        : current.state
    }));
    onDataChanged();
  }

  async function removeRow(row: ProspectSearchRow) {
    const response = await fetchWithActor(`${apiBase}/api/test/prospect-row/remove`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prospectId: row.prospectId,
        businessName: row.businessName,
        contactName: row.contactName,
        contactEmail: row.contactEmail,
        createdOn: row.createdOn,
        ownerName: row.ownerName,
        sourceUrl: row.sourceUrl
      })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    onChange((current) => ({
      ...current,
      state: current.state.data
        ? {
            data: {
              ...current.state.data,
              rows: current.state.data.rows.map((currentRow) =>
                currentRow.prospectId === row.prospectId ? { ...currentRow, added: false } : currentRow
              )
            },
            loading: false
          }
        : current.state,
      detail: current.selectedProspectId === row.prospectId ? { loading: false } : current.detail,
      selectedProspectId: current.selectedProspectId === row.prospectId ? "" : current.selectedProspectId
    }));
    onDataChanged();
  }

  return (
    <section className="table-wrap">
      <div className="table-caption">
        <strong>{sortedRows.length}</strong>
        <span> {mode === "live" ? "live Paymentsense" : "cached"} prospect row{preview.rows.length === 1 ? "" : "s"}</span>
        {filterText.trim() && <span className="filter-note"> filtered from {preview.rows.length}</span>}
      </div>
      <div className="table-caption">
        <div className="table-search table-search-inline">
          <label htmlFor="prospect-import-filter">Filter returned rows</label>
          <input
            id="prospect-import-filter"
            type="search"
            value={filterText}
            onChange={(event) => setFilterText(event.target.value)}
            placeholder="Business, contact name, or postcode"
          />
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>DB</th>
            <th>Action</th>
            <th>{renderSortHeader("Prospect ID", sortKey === "prospectId", sortDirection, () => onSort("prospectId"))}</th>
            <th>{renderSortHeader("Business name", sortKey === "businessName", sortDirection, () => onSort("businessName"))}</th>
            <th>{renderSortHeader("Contact name", sortKey === "contactName", sortDirection, () => onSort("contactName"))}</th>
            <th>Contact email</th>
            <th>Postcode</th>
            <th>{renderSortHeader("Created on", sortKey === "createdOn", sortDirection, () => onSort("createdOn"))}</th>
            <th>Owner</th>
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row, index) => (
            <Fragment key={`${row.prospectId}-${index}`}>
              <tr
                className={getProspectTestRowClassName(row, selectedProspectId, customerContext)}
              >
                <td>
                  <button
                    className="details-button"
                    type="button"
                    onClick={() => void (row.added ? removeRow(row) : insertRow(row))}
                  >
                    {row.added ? "Remove" : "Add"}
                  </button>
                </td>
                <td>
                  <button className="details-button" type="button" onClick={() => onSelect(row.prospectId)}>
                    {row.hasStoredDetail ? "Show" : "Details"}
                  </button>
                </td>
                <td className="mono">
                  <button className="row-link" type="button" onClick={() => onSelect(row.prospectId)}>
                    {row.prospectId}
                  </button>
                </td>
                <td>
                  {row.businessName}
                  {renderProspectHighlightReasons(row, customerContext, "businessName")}
                </td>
                <td>
                  {row.contactName ?? ""}
                  {renderProspectHighlightReasons(row, customerContext, "contactName")}
                </td>
                <td>
                  <CopyableEmail email={row.contactEmail} />
                  {renderProspectHighlightReasons(row, customerContext, "contactEmail")}
                </td>
                <td className="mono">{row.postcode ?? ""}</td>
                <td>{row.createdOn ?? ""}</td>
                <td>{row.ownerName ?? ""}</td>
              </tr>
              {row.prospectId === selectedProspectId && (
                <InlineProspectDetailRow
                  colspan={9}
                  detailState={detailState}
                  customerContext={customerContext}
                  usingCurrentProspect={usingCurrentProspect}
                  onUseCurrentProspect={onUseCurrentProspect}
                />
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function ProspectDetailPanel({
  detail,
  inline = false,
  customerContext = null,
  usingCurrentProspect = false,
  onUseCurrentProspect
}: {
  detail: ProspectDetail;
  inline?: boolean;
  customerContext?: ProspectTestCustomerContext | null;
  usingCurrentProspect?: boolean;
  onUseCurrentProspect?: () => void;
}) {
  const canUseCurrentProspect = Boolean(customerContext && onUseCurrentProspect);

  return (
    <section className={inline ? "detail-panel inline" : "detail-panel"}>
      <div className="detail-header">
        <div>
          <span className="eyebrow">Prospect Detail</span>
          <h3>{detail.businessName}</h3>
          <p className="mono">{detail.prospectId}</p>
        </div>
        <div className="detail-header-actions">
          <Badge text={detail.extractedNow ? "Extracted now" : "Loaded from database"} />
          {canUseCurrentProspect && (
            <button
              className="secondary-action"
              type="button"
              disabled={usingCurrentProspect}
              onClick={onUseCurrentProspect}
            >
              {usingCurrentProspect ? "Using..." : "Use this prospect"}
            </button>
          )}
        </div>
      </div>

      <div className="detail-grid">
        <DetailItem label="Channel" value={detail.channel} />
        <DetailItem label="Origin" value={detail.origin} />
        <DetailItem label="Created" value={detail.createdOn} />
        <DetailItem label="Owner" value={detail.ownerName} />
        <DetailItem label="PS customer match" value={detail.hasPaymentsenseCustomerMatch ? "Yes" : "No"} />
        <DetailItem label="Contact" value={detail.contact.name} />
        <DetailItem label="Phone" value={detail.contact.phone} />
        <DetailItem label="Email" value={<CopyableEmail email={detail.contact.email} />} />
        <DetailItem label="Address" value={formatProspectAddress(detail)} />
      </div>
    </section>
  );
}

function DetailItem({ label, value }: { label: string; value?: ReactNode | string | null }) {
  return (
    <div className="detail-item">
      <span>{label}</span>
      <strong>{value ?? ""}</strong>
    </div>
  );
}

function CopyableEmail({ email }: { email?: string | null }) {
  const [copied, setCopied] = useState(false);

  if (!email) {
    return <>{""}</>;
  }

  const safeEmail = email;

  async function copyEmail() {
    try {
      await navigator.clipboard.writeText(safeEmail);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      className={copied ? "copyable-email copied" : "copyable-email"}
      type="button"
      title={copied ? "Copied" : "Copy email"}
      onClick={(event) => {
        event.stopPropagation();
        void copyEmail();
      }}
    >
      {safeEmail}
    </button>
  );
}

async function copyTextToClipboard(value: string | null | undefined) {
  const text = value?.trim();
  if (!text) {
    return false;
  }

  await navigator.clipboard.writeText(text);
  return true;
}

const leadPriorityOrder: LeadPriority[] = ["very_low", "low", "medium", "high", "urgent"];
const leadPriorityRank: Record<LeadPriority, number> = {
  very_low: 0,
  low: 1,
  medium: 2,
  high: 3,
  urgent: 4
};

function getLeadPriorityLabel(priority?: string | null) {
  switch (priority) {
    case "very_low":
      return "Very low";
    case "low":
      return "Low";
    case "medium":
      return "Medium";
    case "high":
      return "High";
    case "urgent":
      return "Urgent";
    default:
      return "Medium";
  }
}

function LeadPriorityLights({
  value,
  onChange,
  disabled = false
}: {
  value?: string | null;
  onChange?: (priority: LeadPriority) => void;
  disabled?: boolean;
}) {
  const currentValue = (value && leadPriorityOrder.includes(value as LeadPriority) ? value : "medium") as LeadPriority;

  return (
    <div className="lead-priority-lights" aria-label={`Lead priority ${getLeadPriorityLabel(currentValue)}`}>
      {leadPriorityOrder.map((priority) => (
        <button
          key={priority}
          className={currentValue === priority ? `lead-priority-light active ${priority}` : `lead-priority-light ${priority}`}
          type="button"
          disabled={disabled || !onChange}
          title={getLeadPriorityLabel(priority)}
          aria-pressed={currentValue === priority}
          onClick={(event) => {
            event.stopPropagation();
            onChange?.(priority);
          }}
        />
      ))}
    </div>
  );
}

function DashboardView({
  state,
  activityState,
  leads,
  customers,
  users,
  customerActivityStatuses,
  customerValueTypes,
  leadStatuses,
  currentUser,
  currentUserId,
  selectedUserId,
  onSelectedUserIdChange,
  onOpenProspectTest,
  onOpenLead,
  onOpenAiCompanyInsight,
  onDataChanged,
  selectedCustomerId,
  onSelectedCustomerIdChange
}: {
  state: LoadState<Dashboard>;
  activityState: LoadState<ActivityEvent[]>;
  leads: Lead[];
  customers: Customer[];
  users: User[];
  customerActivityStatuses: CustomerActivityStatusOption[];
  customerValueTypes: CustomerValueType[];
  leadStatuses: LeadStatusOption[];
  currentUser: User | null;
  currentUserId: string;
  selectedUserId: string;
  onSelectedUserIdChange: Dispatch<SetStateAction<string>>;
  onOpenProspectTest: (
    customer: Customer,
    field: ProspectTestCustomerContext["filterField"],
    value: string
  ) => void;
  onOpenLead: (leadId: number) => void;
  onOpenAiCompanyInsight: (customer: Pick<Customer, "id" | "entityName" | "tradingName" | "postcode" | "hasAiInsightJobScheduled">) => void;
  onDataChanged: () => void;
  selectedCustomerId: number | null;
  onSelectedCustomerIdChange: Dispatch<SetStateAction<number | null>>;
}) {
  const [notice, setNotice] = useState<ArchiveNotice | null>(null);
  const [openActionCustomerId, setOpenActionCustomerId] = useState<number | null>(null);
  const [savingAssignedUserCustomerId, setSavingAssignedUserCustomerId] = useState<number | null>(null);
  const [bookmarkOverrides, setBookmarkOverrides] = useState<Record<number, boolean>>({});
  const [customerHasNotesOverrides, setCustomerHasNotesOverrides] = useState<Record<number, boolean>>({});
  const [customerValueTypeOverrides, setCustomerValueTypeOverrides] = useState<Record<number, Pick<Customer, "customerValueTypeId" | "customerValueTypeLabel" | "customerValueTypeDecimalValue" | "customerValueTypeShieldOrder" | "customerValueTypeImageFileName">>>({});
  const [customerAiJobScheduledOverrides, setCustomerAiJobScheduledOverrides] = useState<Record<number, boolean>>({});
  const [customerNotesRefreshKeys, setCustomerNotesRefreshKeys] = useState<Record<number, number>>({});
  const [dashboardCustomerMatchState, setDashboardCustomerMatchState] = useState<LoadState<CustomerMatchResult>>({
    loading: false
  });
  const [dashboardLeadSearchText, setDashboardLeadSearchText] = useState("");
  const [dashboardLeadPriorityFilter, setDashboardLeadPriorityFilter] = useState("all");
  const [dashboardLeadSortKey, setDashboardLeadSortKey] = useState<"id" | "customerName" | "tradingName" | "contactEmail" | "postcode" | "leadPriority" | "leadStatus" | "createdAt">("createdAt");
  const [dashboardLeadSortDirection, setDashboardLeadSortDirection] = useState<SortDirection>("desc");
  const [savingLeadPriorityId, setSavingLeadPriorityId] = useState<number | null>(null);
  const [dashboardCustomerSearchText, setDashboardCustomerSearchText] = useState("");
  const [dashboardCustomerSortKey, setDashboardCustomerSortKey] = useState<"entityName" | "tradingName" | "customerActivityStatusName" | "regionName" | "postcode" | "status" | "addedAt">("addedAt");
  const [dashboardCustomerSortDirection, setDashboardCustomerSortDirection] = useState<SortDirection>("desc");
  const [customerContextMenuState, setCustomerContextMenuState] = useState<CustomerRowContextMenuState | null>(null);
  const [noteModalState, setNoteModalState] = useState<CustomerNoteModalState>({
    open: false,
    notesState: { loading: false },
    noteText: "",
    notedAt: "",
    saving: false
  });
  const [ownedChecklistModalState, setOwnedChecklistModalState] = useState<OwnedChecklistModalState>({
    open: false,
    matchesState: { loading: false }
  });

  useEffect(() => {
    setBookmarkOverrides({});
  }, [currentUserId]);

  useEffect(() => {
    const validIds = new Set(customers.map((customer) => customer.id));
    setCustomerAiJobScheduledOverrides((current) =>
      Object.fromEntries(Object.entries(current).filter(([customerId]) => validIds.has(Number(customerId))))
    );
  }, [customers]);

  async function loadDashboardCustomerMatches(customer: Customer) {
    if (selectedCustomerId === customer.id && !dashboardCustomerMatchState.loading) {
      onSelectedCustomerIdChange(null);
      setDashboardCustomerMatchState({ loading: false });
      return;
    }

    onSelectedCustomerIdChange(customer.id);
    setDashboardCustomerMatchState({ loading: true });

    try {
      const response = await fetchWithActor(`${apiBase}/api/customers/${customer.id}/matches`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as CustomerMatchResult;
      setDashboardCustomerMatchState({ data, loading: false });
    } catch (error) {
      setDashboardCustomerMatchState({
        error: error instanceof Error ? error.message : "Could not load customer details.",
        loading: false
      });
    }
  }

  useEffect(() => {
    if (!selectedCustomerId || !customers.length) {
      return;
    }

    if (dashboardCustomerMatchState.loading) {
      return;
    }

    if (dashboardCustomerMatchState.data?.customerId === selectedCustomerId) {
      return;
    }

    const customer = customers.find((row) => row.id === selectedCustomerId);
    if (!customer) {
      return;
    }

    void loadDashboardCustomerMatches(customer);
  }, [selectedCustomerId, customers, dashboardCustomerMatchState.loading, dashboardCustomerMatchState.data?.customerId]);

  useEffect(() => {
    if (!selectedCustomerId) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      const row = document.querySelector(`[data-dashboard-customer-row-id="${selectedCustomerId}"]`) as HTMLElement | null;
      row?.scrollIntoView({ block: "center", behavior: "auto" });
    });

    return () => cancelAnimationFrame(frame);
  }, [selectedCustomerId, dashboardCustomerMatchState.loading]);

  if (state.loading) return <PanelSkeleton />;
  if (state.error) return <ErrorPanel error={state.error} />;
  if (!state.data) return <EmptyPanel message="No dashboard data returned." />;

  const selectedUser = users.find((user) => String(user.id) === selectedUserId);
  const assignedLeads = selectedUser
    ? leads.filter((lead) => lead.assignedUserId === selectedUser.id)
    : [];
  const assignedCustomers = selectedUser
    ? customers
        .map((customer) => ({
          ...customer,
          isBookmarked: bookmarkOverrides[customer.id] ?? customer.isBookmarked,
          hasNotes: customerHasNotesOverrides[customer.id] ?? customer.hasNotes,
          hasAiInsightJobScheduled: customerAiJobScheduledOverrides[customer.id] ?? customer.hasAiInsightJobScheduled,
          ...(customerValueTypeOverrides[customer.id] ?? {})
        }))
        .filter((customer) => customer.assignedUserId === selectedUser.id)
    : [];
  const filteredAssignedLeads = assignedLeads
    .filter((lead) => {
      if (dashboardLeadPriorityFilter !== "all" && lead.leadPriority !== dashboardLeadPriorityFilter) {
        return false;
      }

      const query = dashboardLeadSearchText.trim().toLowerCase();
      if (!query) return true;
      return [
        `Lead ${lead.id}`,
        lead.customerName,
        lead.customerRef,
        lead.mid,
        lead.tradingName,
        lead.contactPhone,
        lead.contactEmail,
        lead.postcode,
        lead.leadStatus
      ]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(query));
    })
    .sort((left, right) =>
      compareValues(
        getDashboardLeadSortValue(left, dashboardLeadSortKey),
        getDashboardLeadSortValue(right, dashboardLeadSortKey),
        dashboardLeadSortDirection
      )
    );
  const filteredAssignedCustomers = assignedCustomers
    .filter((customer) => {
      const query = dashboardCustomerSearchText.trim().toLowerCase();
      if (!query) return true;
      return [
        customer.entityName,
        customer.tradingName,
        customer.customerActivityStatusName,
        customer.regionName,
        customer.postcode,
        customer.status
      ]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(query));
    })
    .sort((left, right) =>
      compareValues(
        getDashboardCustomerSortValue(left, dashboardCustomerSortKey),
        getDashboardCustomerSortValue(right, dashboardCustomerSortKey),
        dashboardCustomerSortDirection
      )
    );
  const tiles = [
    ["Search runs", state.data.searchRuns],
    ["Extracted records", state.data.extractedRecords],
    ["Organisations", state.data.organisations],
    ["Prospects", state.data.prospects],
    ["Customers", state.data.customers],
    ["Candidate matches", state.data.candidateMatches],
    ["Needs review", state.data.needsReviewMatches]
  ];

  async function assignLeadUser(leadId: number, assignedUserId: string) {
    setNotice(null);
    try {
      const response = await fetchWithActor(`${apiBase}/api/leads/${leadId}/assigned-user`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignedUserId: assignedUserId ? Number(assignedUserId) : null })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? `HTTP ${response.status}`);
      }
      onDataChanged();
      setNotice({ kind: "success", message: "Lead assignment updated." });
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not update lead assignment."
      });
    }
  }

  async function updateLeadStatus(leadId: number, leadStatus: string) {
    setNotice(null);
    try {
      const response = await fetchWithActor(`${apiBase}/api/leads/${leadId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadStatus })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? `HTTP ${response.status}`);
      }
      onDataChanged();
      setNotice({ kind: "success", message: "Lead status updated." });
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not update lead status."
      });
    }
  }

  async function updateLeadPriority(leadId: number, leadPriority: LeadPriority) {
    setSavingLeadPriorityId(leadId);
    setNotice(null);
    try {
      const response = await fetchWithActor(`${apiBase}/api/leads/${leadId}/priority`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadPriority })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? `HTTP ${response.status}`);
      }
      onDataChanged();
      setNotice({ kind: "success", message: "Lead priority updated." });
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not update lead priority."
      });
    } finally {
      setSavingLeadPriorityId(null);
    }
  }

  async function assignCustomerUser(customer: Customer, assignedUserId: string) {
    setSavingAssignedUserCustomerId(customer.id);
    setNotice(null);

    try {
      const response = await fetchWithActor(`${apiBase}/api/customers/${customer.id}/assigned-user`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignedUserId: assignedUserId ? Number(assignedUserId) : null })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? `HTTP ${response.status}`);
      }

      onDataChanged();
      const assignedUser = users.find((user) => String(user.id) === assignedUserId);
      setNotice({
        kind: "success",
        message: assignedUserId
          ? `${customer.customerRef ?? customer.entityName} assigned to ${assignedUser?.fullName ?? "the selected user"}.`
          : `${customer.customerRef ?? customer.entityName} unassigned.`
      });
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not update customer assignment."
      });
    } finally {
      setSavingAssignedUserCustomerId(null);
      setOpenActionCustomerId(null);
    }
  }

  async function updateCustomerActivityStatus(customer: Customer, customerActivityStatusId: string) {
    setNotice(null);
    try {
      const response = await fetchWithActor(`${apiBase}/api/customers/${customer.id}/activity-status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerActivityStatusId: customerActivityStatusId ? Number(customerActivityStatusId) : null })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? `HTTP ${response.status}`);
      }
      onDataChanged();
      setNotice({ kind: "success", message: "Customer activity status updated." });
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not update customer activity status."
      });
    }
  }

  async function archiveCustomer(customer: Customer) {
    setNotice(null);
    try {
      const response = await fetchWithActor(`${apiBase}/api/customers/${customer.id}/archive`, { method: "POST" });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? `HTTP ${response.status}`);
      }
      onDataChanged();
      setNotice({ kind: "success", message: `${customer.customerRef ?? customer.entityName} archived.` });
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not archive customer."
      });
    } finally {
      setOpenActionCustomerId(null);
    }
  }

  async function scheduleCustomerAiInsight(customer: Customer) {
    setNotice(null);

    try {
      const response = await fetchWithActor(`${apiBase}/api/jobs/ai-company-insight`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          searchName: (customer.tradingName || customer.entityName).trim(),
          searchLocation: customer.postcode || null,
          customerId: customer.id,
          saveToDatabase: true
        })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? `HTTP ${response.status}`);
      }

      setCustomerAiJobScheduledOverrides((current) => ({ ...current, [customer.id]: true }));
      setNotice({
        kind: "success",
        message: `AI insight scheduled for ${customer.tradingName || customer.entityName}.`
      });
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not schedule AI insight."
      });
    } finally {
      setOpenActionCustomerId(null);
    }
  }

  async function toggleCustomerBookmark(customer: Customer) {
    setNotice(null);
    try {
      const response = await fetchWithActor(`${apiBase}/api/customers/${customer.id}/bookmark`, {
        method: customer.isBookmarked ? "DELETE" : "POST"
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? `HTTP ${response.status}`);
      }
      setBookmarkOverrides((current) => ({ ...current, [customer.id]: !customer.isBookmarked }));
      setNotice({
        kind: "success",
        message: customer.isBookmarked
          ? `${customer.customerRef ?? customer.entityName} bookmark removed.`
          : `${customer.customerRef ?? customer.entityName} bookmarked.`
      });
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not update customer bookmark."
      });
    } finally {
      setOpenActionCustomerId(null);
    }
  }

  async function clearCustomerBookmarks() {
    setNotice(null);
    try {
      const response = await fetchWithActor(`${apiBase}/api/customers/bookmarks`, {
        method: "DELETE"
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? `HTTP ${response.status}`);
      }
      setBookmarkOverrides(() =>
        Object.fromEntries((customers ?? []).map((customer) => [customer.id, false]))
      );
      setNotice({ kind: "success", message: "Bookmarks cleared." });
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not clear bookmarks."
      });
    } finally {
      setOpenActionCustomerId(null);
    }
  }

  async function copyCustomerRowValue(value: string | null | undefined, label: string) {
    try {
      const copied = await copyTextToClipboard(value);
      if (!copied) {
        throw new Error(`No ${label.toLowerCase()} available.`);
      }
      setNotice({ kind: "success", message: `${label} copied.` });
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : `Could not copy ${label.toLowerCase()}.`
      });
    }
  }

  async function assignCustomerToCurrentUser(customer: Customer) {
    if (!currentUser) {
      setNotice({ kind: "error", message: "Current user is unknown." });
      return;
    }

    await assignCustomerUser(customer, String(currentUser.id));
  }

  async function openCustomerNotes(customer: Customer) {
    setOpenActionCustomerId(null);
    setNoteModalState({
      open: true,
      customer,
      notesState: { loading: true },
      noteText: "",
      notedAt: new Date().toISOString().slice(0, 16),
      saving: false
    });

    try {
      const response = await fetchWithActor(`${apiBase}/api/customers/${customer.id}/notes`);
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? `HTTP ${response.status}`);
      }
      const notes = (await response.json()) as CustomerNote[];
      setNoteModalState((current) => ({
        ...current,
        notesState: { data: notes, loading: false }
      }));
    } catch (error) {
      setNoteModalState((current) => ({
        ...current,
        notesState: {
          error: error instanceof Error ? error.message : "Could not load customer notes.",
          loading: false
        }
      }));
    }
  }

  async function openOwnedChecklist(customer: Customer) {
    setOwnedChecklistModalState({
      open: true,
      customer,
      matchesState: { loading: true }
    });

    try {
      const response = await fetchWithActor(`${apiBase}/api/customers/${customer.id}/owned-checklist`);
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? `HTTP ${response.status}`);
      }
      const matches = (await response.json()) as OwnedChecklistMatch[];
      setOwnedChecklistModalState((current) => ({
        ...current,
        matchesState: { data: matches, loading: false }
      }));
    } catch (error) {
      setOwnedChecklistModalState((current) => ({
        ...current,
        matchesState: {
          error: error instanceof Error ? error.message : "Could not load ownership signals.",
          loading: false
        }
      }));
    }
  }

  async function openCustomerOwnedChecklist(customer: Customer) {
    setOwnedChecklistModalState({
      open: true,
      customer,
      matchesState: { loading: true }
    });

    try {
      const response = await fetchWithActor(`${apiBase}/api/customers/${customer.id}/owned-checklist`);
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? `HTTP ${response.status}`);
      }
      const matches = (await response.json()) as OwnedChecklistMatch[];
      setOwnedChecklistModalState((current) => ({
        ...current,
        matchesState: { data: matches, loading: false }
      }));
    } catch (error) {
      setOwnedChecklistModalState((current) => ({
        ...current,
        matchesState: {
          error: error instanceof Error ? error.message : "Could not load ownership signals.",
          loading: false
        }
      }));
    }
  }

  async function saveCustomerNote() {
    if (!noteModalState.customer) return;
    const customer = noteModalState.customer;
    setNoteModalState((current) => ({ ...current, saving: true }));

    try {
      const response = await fetchWithActor(`${apiBase}/api/customers/${customer.id}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          noteText: noteModalState.noteText,
          createdAt: noteModalState.notedAt || null
        })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? `HTTP ${response.status}`);
      }
      const notes = (await response.json()) as CustomerNote[];
      setNoteModalState((current) => ({
        ...current,
        notesState: { data: notes, loading: false },
        noteText: "",
        notedAt: new Date().toISOString().slice(0, 16),
        saving: false
      }));
      setCustomerHasNotesOverrides((current) => ({ ...current, [customer.id]: notes.length > 0 }));
      setCustomerNotesRefreshKeys((current) => ({
        ...current,
        [customer.id]: (current[customer.id] ?? 0) + 1
      }));
      onDataChanged();
      setNotice({ kind: "success", message: `Note added to ${customer.customerRef ?? customer.entityName}.` });
    } catch (error) {
      setNoteModalState((current) => ({
        ...current,
        saving: false
      }));
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not add customer note."
      });
    }
  }

  function downloadAssignedCsv() {
    if (!selectedUser) return;

    const params = new URLSearchParams({
      assignedUserId: String(selectedUser.id)
    });
    const link = document.createElement("a");
    link.href = `${apiBase}/api/leads/export?${params.toString()}`;
    link.download = `${selectedUser.fullName.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "assigned-leads"}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function handleDashboardLeadSort(nextKey: typeof dashboardLeadSortKey) {
    if (dashboardLeadSortKey === nextKey) {
      setDashboardLeadSortDirection((current) => current === "asc" ? "desc" : "asc");
      return;
    }

    setDashboardLeadSortKey(nextKey);
    setDashboardLeadSortDirection(nextKey === "createdAt" ? "desc" : "asc");
  }

  function handleDashboardCustomerSort(nextKey: typeof dashboardCustomerSortKey) {
    if (dashboardCustomerSortKey === nextKey) {
      setDashboardCustomerSortDirection((current) => current === "asc" ? "desc" : "asc");
      return;
    }

    setDashboardCustomerSortKey(nextKey);
    setDashboardCustomerSortDirection(nextKey === "addedAt" ? "desc" : "asc");
  }

  return (
    <div className="test-page">
      <section className="table-controls">
        <div className="table-search table-search-compact">
          <label htmlFor="dashboard-user-select">User</label>
          <select
            id="dashboard-user-select"
            className="header-select"
            value={selectedUserId}
            onChange={(event) => onSelectedUserIdChange(event.target.value)}
          >
            <option value="">All users</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.fullName}
              </option>
            ))}
          </select>
        </div>
        {selectedUser ? (
          <div className="page-action-note">
            Showing dashboard for <strong>{selectedUser.fullName}</strong>
          </div>
        ) : (
          <div className="page-action-note">Showing dashboard for all users</div>
        )}
      </section>
      <section className="metric-grid">
        {tiles.map(([label, value]) => (
          <div className="metric-tile" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </section>
      {notice && <StatusBanner kind={notice.kind} message={notice.message} />}
      {selectedUser && (
        <section className="detail-panel dashboard-assigned-customers-panel">
          <div className="detail-header">
            <div>
              <span className="eyebrow">Assigned leads</span>
              <h3>{selectedUser.fullName}</h3>
              <p>{filteredAssignedLeads.length} assigned lead{filteredAssignedLeads.length === 1 ? "" : "s"}</p>
            </div>
            <div className="panel-actions">
              <button className="secondary-action" type="button" onClick={downloadAssignedCsv}>
                Download CSV
              </button>
            </div>
          </div>
          <section className="table-controls">
            <div className="table-search">
              <label htmlFor="dashboard-leads-search">Search leads</label>
              <input
                id="dashboard-leads-search"
                type="search"
                value={dashboardLeadSearchText}
                onChange={(event) => setDashboardLeadSearchText(event.target.value)}
                placeholder="Customer, trading, email, postcode, status"
              />
            </div>
            <div className="table-search table-search-compact">
              <label htmlFor="dashboard-leads-priority-filter">Priority</label>
              <select
                id="dashboard-leads-priority-filter"
                className="header-select"
                value={dashboardLeadPriorityFilter}
                onChange={(event) => setDashboardLeadPriorityFilter(event.target.value)}
              >
                <option value="all">All priorities</option>
                {leadPriorityOrder.map((priority) => (
                  <option key={priority} value={priority}>
                    {getLeadPriorityLabel(priority)}
                  </option>
                ))}
              </select>
            </div>
          </section>
          {filteredAssignedLeads.length ? (
            <DataTable
              state={{ data: filteredAssignedLeads, loading: false }}
              emptyMessage="No leads assigned."
              columns={[
                renderSortHeader("Lead", dashboardLeadSortKey === "id", dashboardLeadSortDirection, () => handleDashboardLeadSort("id")),
                renderSortHeader("Customer", dashboardLeadSortKey === "customerName", dashboardLeadSortDirection, () => handleDashboardLeadSort("customerName")),
                "User",
                renderSortHeader("Trading name", dashboardLeadSortKey === "tradingName", dashboardLeadSortDirection, () => handleDashboardLeadSort("tradingName")),
                "Phone",
                renderSortHeader("Email", dashboardLeadSortKey === "contactEmail", dashboardLeadSortDirection, () => handleDashboardLeadSort("contactEmail")),
                renderSortHeader("Postcode", dashboardLeadSortKey === "postcode", dashboardLeadSortDirection, () => handleDashboardLeadSort("postcode")),
                renderSortHeader("Priority", dashboardLeadSortKey === "leadPriority", dashboardLeadSortDirection, () => handleDashboardLeadSort("leadPriority")),
                renderSortHeader("Status", dashboardLeadSortKey === "leadStatus", dashboardLeadSortDirection, () => handleDashboardLeadSort("leadStatus")),
                renderSortHeader("Created", dashboardLeadSortKey === "createdAt", dashboardLeadSortDirection, () => handleDashboardLeadSort("createdAt"))
              ]}
              renderRow={(row) => (
                <tr key={row.id}>
                  <td>
                    <button className="row-link" type="button" onClick={() => onOpenLead(row.id)}>
                      Lead #{row.id}
                    </button>
                  </td>
                  <td>
                    <span className="stacked">{row.customerName}</span>
                  </td>
                  <td>
                    <select
                      className="header-select"
                      value={row.assignedUserId ? String(row.assignedUserId) : ""}
                      onChange={(event) => void assignLeadUser(row.id, event.target.value)}
                    >
                      <option value="">Unassigned</option>
                      {users.map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.fullName}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>{row.tradingName ?? ""}</td>
                  <td>{row.contactPhone ?? ""}</td>
                  <td><CopyableEmail email={row.contactEmail} /></td>
                  <td className="mono">{row.postcode ?? ""}</td>
                  <td>
                    <LeadPriorityLights
                      value={row.leadPriority}
                      disabled={savingLeadPriorityId === row.id}
                      onChange={(priority) => void updateLeadPriority(row.id, priority)}
                    />
                  </td>
                  <td>
                    <select
                      className="header-select"
                      value={row.leadStatus}
                      onChange={(event) => void updateLeadStatus(row.id, event.target.value)}
                    >
                      {leadStatuses.map((status) => (
                        <option key={status.id} value={status.name}>
                          {status.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>{formatDateTime(row.createdAt)}</td>
                </tr>
              )}
            />
          ) : (
            <p className="muted">No leads assigned to this user yet.</p>
          )}
        </section>
      )}
      {selectedUser && (
        <section className="detail-panel dashboard-assigned-customers-panel">
          <div className="detail-header">
            <div>
              <span className="eyebrow">Assigned customers</span>
              <h3>{selectedUser.fullName}</h3>
              <p>{filteredAssignedCustomers.length} assigned customer{filteredAssignedCustomers.length === 1 ? "" : "s"}</p>
            </div>
          </div>
          <section className="table-controls">
            <div className="table-search">
              <label htmlFor="dashboard-customers-search">Search customers</label>
              <input
                id="dashboard-customers-search"
                type="search"
                value={dashboardCustomerSearchText}
                onChange={(event) => setDashboardCustomerSearchText(event.target.value)}
                placeholder="Entity, trading, region, postcode, status"
              />
            </div>
          </section>
          {filteredAssignedCustomers.length ? (
            <DataTable
              state={{ data: filteredAssignedCustomers, loading: false }}
              emptyMessage="No customers assigned."
              columns={[
                "Action",
                renderSortHeader("Entity", dashboardCustomerSortKey === "entityName", dashboardCustomerSortDirection, () => handleDashboardCustomerSort("entityName")),
                renderSortHeader("Trading name", dashboardCustomerSortKey === "tradingName", dashboardCustomerSortDirection, () => handleDashboardCustomerSort("tradingName")),
                renderSortHeader("Activity", dashboardCustomerSortKey === "customerActivityStatusName", dashboardCustomerSortDirection, () => handleDashboardCustomerSort("customerActivityStatusName")),
                renderSortHeader("Region", dashboardCustomerSortKey === "regionName", dashboardCustomerSortDirection, () => handleDashboardCustomerSort("regionName")),
                renderSortHeader("Postcode", dashboardCustomerSortKey === "postcode", dashboardCustomerSortDirection, () => handleDashboardCustomerSort("postcode")),
                renderSortHeader("Status", dashboardCustomerSortKey === "status", dashboardCustomerSortDirection, () => handleDashboardCustomerSort("status")),
                renderSortHeader("Added", dashboardCustomerSortKey === "addedAt", dashboardCustomerSortDirection, () => handleDashboardCustomerSort("addedAt"))
              ]}
              renderRow={(row) => {
                const bookmarkDot = getCustomerBookmarkDotState(row, currentUser);
                return (
                <Fragment key={row.id}>
                  <tr
                    className={getCustomerRowClassName(row.id === selectedCustomerId, false, row.hasLead)}
                    data-dashboard-customer-row-id={row.id}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setCustomerContextMenuState({
                        customer: row,
                        x: Math.min(event.clientX, window.innerWidth - 260),
                        y: Math.min(event.clientY, window.innerHeight - 72)
                      });
                    }}
                  >
                    <td>
                      <CustomerSplitActionButton
                        customer={row}
                        users={users}
                        bookmarkDotColor={bookmarkDot.color}
                        showBookmarkDot={bookmarkDot.show}
                        savingAssignedUserCustomerId={savingAssignedUserCustomerId}
                        openActionCustomerId={openActionCustomerId}
                        onToggleOpenActionCustomerId={setOpenActionCustomerId}
                        onPrimaryAction={() => void loadDashboardCustomerMatches(row)}
                        onAssignUser={assignCustomerUser}
                        onOpenNotes={openCustomerNotes}
                        onScheduleAiInsight={scheduleCustomerAiInsight}
                        onToggleBookmark={toggleCustomerBookmark}
                        onClearBookmarks={clearCustomerBookmarks}
                        onArchive={archiveCustomer}
                        primaryLabel="Open"
                      />
                    </td>
                    <td>{row.entityName}</td>
                    <td>{row.tradingName ?? ""}</td>
                    <td>
                      <select
                        className="header-select"
                        value={row.customerActivityStatusId ? String(row.customerActivityStatusId) : ""}
                        onChange={(event) => void updateCustomerActivityStatus(row, event.target.value)}
                      >
                        <option value="">No activity status</option>
                        {customerActivityStatuses.map((status) => (
                          <option key={status.id} value={status.id}>
                            {status.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>{row.regionName ?? ""}</td>
                    <td className="mono">{row.postcode ?? ""}</td>
                    <td>{renderCustomerStatus(row.status, row.customerKind, row.hasNotes, row.hasOwnedChecklistMatch, row.customerValueTypeImageFileName, row.attachedProspectCount, () => void openCustomerNotes(row), () => void openOwnedChecklist(row))}</td>
                    <td>{formatDateTime(row.addedAt)}</td>
                  </tr>
                  {row.id === selectedCustomerId && (
                    <CustomerMatchDetailRow
                      colspan={8}
                      state={dashboardCustomerMatchState}
                      customerId={row.id}
                      customer={row}
                      customerValueTypes={customerValueTypes}
                      notesRefreshKey={customerNotesRefreshKeys[row.id] ?? 0}
                      onCustomerValueChanged={(customerId, next) =>
                        setCustomerValueTypeOverrides((current) => ({ ...current, [customerId]: next }))
                      }
                      onOpenLead={onOpenLead}
                      onOpenAiCompanyInsight={onOpenAiCompanyInsight}
                      onDataChanged={onDataChanged}
                      onMatchesChanged={(next) => setDashboardCustomerMatchState({ data: next, loading: false })}
                    />
                  )}
                </Fragment>
                );
              }}
            />
          ) : (
            <p className="muted">No customers assigned to this user yet.</p>
          )}
        </section>
      )}
      <section className="detail-panel">
        <div className="detail-header">
          <div>
            <span className="eyebrow">Recent activity</span>
            <h3>Event log</h3>
            <p>Recent changes across leads, customers, prospects, and campaigns.</p>
          </div>
        </div>
        <ActivityEventList state={activityState} />
      </section>
      <CustomerNotesModal
        state={noteModalState}
        onClose={() => setNoteModalState({ open: false, notesState: { loading: false }, noteText: "", notedAt: "", saving: false })}
        onNoteTextChange={(value) => setNoteModalState((current) => ({ ...current, noteText: value }))}
        onNotedAtChange={(value) => setNoteModalState((current) => ({ ...current, notedAt: value }))}
        onSave={() => void saveCustomerNote()}
      />
      <OwnedChecklistModal
        state={ownedChecklistModalState}
        onClose={() => setOwnedChecklistModalState({ open: false, matchesState: { loading: false } })}
      />
      <CustomerRowContextMenu
        state={customerContextMenuState}
        onClose={() => setCustomerContextMenuState(null)}
        onToggleBookmark={toggleCustomerBookmark}
        canAssignToCurrentUser={Boolean(currentUser)}
        onAssignToCurrentUser={assignCustomerToCurrentUser}
        onCopyEntityName={(customer) => copyCustomerRowValue(customer.entityName, "Entity name")}
        onCopyTradingName={(customer) => copyCustomerRowValue(customer.tradingName, "Trading name")}
        onCopyPostcode={(customer) => copyCustomerRowValue(customer.postcode, "Postcode")}
      />
    </div>
  );
}

function AiSettingsView({
  form,
  onFormChange
}: {
  form: GeminiSettingsState;
  onFormChange: Dispatch<SetStateAction<GeminiSettingsState>>;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<ArchiveNotice | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadSetting() {
      setLoading(true);
      try {
        const response = await fetchWithActor(`${apiBase}/api/settings/gemini`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json() as { apiKey?: string | null };
        if (!cancelled) {
          onFormChange({ apiKey: data.apiKey ?? "" });
        }
      } catch (error) {
        if (!cancelled) {
          setNotice({
            kind: "error",
            message: error instanceof Error ? error.message : "Could not load Gemini key."
          });
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
      }
    }
  }

    void loadSetting();
    return () => {
      cancelled = true;
    };
  }, [onFormChange]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setNotice(null);

    try {
      const response = await fetchWithActor(`${apiBase}/api/settings/gemini`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: form.apiKey })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as { apiKey?: string | null };
      onFormChange({ apiKey: data.apiKey ?? "" });
      setNotice({ kind: "success", message: "Gemini key saved." });
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not save Gemini key."
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="test-page">
      <section className="detail-panel">
        <div className="detail-header">
          <div>
            <span className="eyebrow">AI Settings</span>
            <h3>Gemini</h3>
            <p>Maintain the Gemini key used by AI Company Insight.</p>
          </div>
        </div>
        {notice && <StatusBanner kind={notice.kind} message={notice.message} />}
        {loading ? (
          <PanelSkeleton compact />
        ) : (
          <form className="search-form" onSubmit={(event) => void save(event)}>
            <div className="table-search">
              <label htmlFor="gemini-api-key">Gemini key</label>
              <input
                id="gemini-api-key"
                type="text"
                value={form.apiKey}
                onChange={(event) => onFormChange({ apiKey: event.target.value })}
                placeholder="AIza..."
              />
            </div>
            <div className="page-actions">
              <button className="page-action-button" type="submit" disabled={saving}>
                {saving ? "Saving..." : "Save Gemini key"}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}

function JobsView() {
  const [jobsState, setJobsState] = useState<LoadState<QueuedJob[]>>({ loading: true });
  const [overviewState, setOverviewState] = useState<LoadState<JobOverview>>({ loading: true });
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [includeRemoved, setIncludeRemoved] = useState(false);
  const [notice, setNotice] = useState<ArchiveNotice | null>(null);
  const [selectedJob, setSelectedJob] = useState<QueuedJob | null>(null);
  const [selectedJobAiInsight, setSelectedJobAiInsight] = useState<JobAiInsightModalState | null>(null);
  const [workingJobId, setWorkingJobId] = useState<number | null>(null);

  function buildJobsQueryString() {
    const query = new URLSearchParams();
    if (searchText.trim()) query.set("searchText", searchText.trim());
    if (statusFilter !== "all") query.set("status", statusFilter);
    if (typeFilter !== "all") query.set("jobType", typeFilter);
    if (includeRemoved) query.set("includeRemoved", "true");
    return query.toString();
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const query = buildJobsQueryString();

        const [jobsResponse, overviewResponse] = await Promise.all([
          fetchWithActor(`${apiBase}/api/jobs${query ? `?${query}` : ""}`),
          fetchWithActor(`${apiBase}/api/jobs/overview`)
        ]);
        if (!jobsResponse.ok) throw new Error(`HTTP ${jobsResponse.status}`);
        if (!overviewResponse.ok) throw new Error(`HTTP ${overviewResponse.status}`);

        const [jobs, overview] = await Promise.all([
          jobsResponse.json() as Promise<QueuedJob[]>,
          overviewResponse.json() as Promise<JobOverview>
        ]);

        if (cancelled) {
          return;
        }

        setJobsState({ data: jobs, loading: false });
        setOverviewState({ data: overview, loading: false });
        setSelectedJob((current) => jobs.find((job) => job.id === current?.id) ?? current);
      } catch (error) {
        if (cancelled) {
          return;
        }

        const message = error instanceof Error ? error.message : "Could not load jobs.";
        setJobsState((current) => ({ data: current.data, error: message, loading: false }));
        setOverviewState((current) => ({ data: current.data, error: message, loading: false }));
      }
    }

    setJobsState((current) => ({ data: current.data, loading: true }));
    setOverviewState((current) => ({ data: current.data, loading: true }));
    void load();
    const timer = window.setInterval(() => void load(), 10000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [includeRemoved, searchText, statusFilter, typeFilter]);

  const jobs = jobsState.data ?? [];
  const jobTypes = Array.from(new Set(jobs.map((job) => job.jobType))).sort((left, right) => left.localeCompare(right));

  async function runJobAction(jobId: number, action: "cancel" | "retry" | "remove") {
    setWorkingJobId(jobId);
    setNotice(null);

    try {
      const response = await fetchWithActor(
        `${apiBase}/api/jobs/${jobId}${action === "remove" ? "" : `/${action}`}`,
        { method: action === "remove" ? "DELETE" : "POST" }
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? `HTTP ${response.status}`);
      }

      setNotice({
        kind: "success",
        message:
          action === "cancel"
            ? "Job cancelled."
            : action === "retry"
              ? "Job retried."
              : "Job removed."
      });

      const [jobsResponse, overviewResponse] = await Promise.all([
        fetchWithActor(`${apiBase}/api/jobs${buildJobsQueryString() ? `?${buildJobsQueryString()}` : ""}`),
        fetchWithActor(`${apiBase}/api/jobs/overview`)
      ]);
      const [nextJobs, nextOverview] = await Promise.all([
        jobsResponse.json() as Promise<QueuedJob[]>,
        overviewResponse.json() as Promise<JobOverview>
      ]);
      setJobsState({ data: nextJobs, loading: false });
      setOverviewState({ data: nextOverview, loading: false });
      setSelectedJob((current) => nextJobs.find((job) => job.id === current?.id) ?? null);
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not update the job."
      });
    } finally {
      setWorkingJobId(null);
    }
  }

  function openJob(job: QueuedJob) {
    const insight = getAiInsightFromJob(job);
    if (insight) {
      setSelectedJobAiInsight({ job, insight });
      return;
    }

    setSelectedJob(job);
  }

  return (
    <div className="test-page">
      {notice && <StatusBanner kind={notice.kind} message={notice.message} />}
      <section className="detail-panel">
        <div className="detail-header">
          <div>
            <span className="eyebrow">Jobs</span>
            <h3>Queue Dashboard</h3>
            <p>Queued, scheduled, running, completed, and cancelled background work.</p>
          </div>
        </div>
        {overviewState.loading && !overviewState.data ? (
          <PanelSkeleton compact />
        ) : overviewState.error && !overviewState.data ? (
          <ErrorPanel error={overviewState.error} compact />
        ) : overviewState.data ? (
          <div className="jobs-overview-grid">
            <div className="detail-item"><span>Total</span><strong>{overviewState.data.summary.total}</strong></div>
            <div className="detail-item"><span>Pending</span><strong>{overviewState.data.summary.pending}</strong></div>
            <div className="detail-item"><span>Queued</span><strong>{overviewState.data.summary.queued}</strong></div>
            <div className="detail-item"><span>Running</span><strong>{overviewState.data.summary.running}</strong></div>
            <div className="detail-item"><span>Completed</span><strong>{overviewState.data.summary.completed}</strong></div>
            <div className="detail-item"><span>Failed</span><strong>{overviewState.data.summary.failed}</strong></div>
            <div className="detail-item"><span>Cancelled</span><strong>{overviewState.data.summary.cancelled}</strong></div>
            <div className="detail-item">
              <span>{overviewState.data.queue.queueName}</span>
              <strong>
                {overviewState.data.queue.available
                  ? `${overviewState.data.queue.readyCount} ready / ${overviewState.data.queue.unackedCount} running / ${overviewState.data.queue.consumerCount} workers`
                  : overviewState.data.queue.error ?? "Unavailable"}
              </strong>
            </div>
          </div>
        ) : null}
      </section>

      <section className="table-controls">
        <div className="table-search">
          <label htmlFor="jobs-search">Search jobs</label>
          <input
            id="jobs-search"
            type="search"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Name, type, requester"
          />
        </div>
        <label className="header-filter">
          <span>Status</span>
          <select className="header-select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="queued">Queued</option>
            <option value="running">Running</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="cancel_requested">Cancel requested</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
        <label className="header-filter">
          <span>Type</span>
          <select className="header-select" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
            <option value="all">All</option>
            {jobTypes.map((jobType) => (
              <option key={jobType} value={jobType}>
                {formatJobTypeLabel(jobType)}
              </option>
            ))}
          </select>
        </label>
        <label className="header-filter">
          <input type="checkbox" checked={includeRemoved} onChange={(event) => setIncludeRemoved(event.target.checked)} />
          <span>Show removed</span>
        </label>
      </section>

      <DataTable
        state={jobsState}
        emptyMessage="No jobs found."
        columns={["Job", "Type", "Status", "Scheduled", "Requested By", "Attempts", "Step", "Action"]}
        className="jobs-table"
        renderRow={(job) => (
          <tr key={job.id}>
            <td>
              <button className="row-link" type="button" onClick={() => openJob(job)}>
                {job.displayName}
              </button>
              <div className="muted">#{job.id}</div>
            </td>
            <td>{formatJobTypeLabel(job.jobType)}</td>
            <td>
              <span className={`job-status-pill status-${job.status}`}>{formatJobStatusLabel(job.status)}</span>
            </td>
            <td>{formatDateTime(job.scheduledFor)}</td>
            <td>{job.requestedByUserName ?? "Unknown"}</td>
            <td>{job.attemptCount} / {job.maxAttempts}</td>
            <td>{job.currentStep ?? job.errorText ?? ""}</td>
            <td>
              <div className="row-actions">
                <button className="secondary-action" type="button" onClick={() => setSelectedJob(job)}>
                  Inspect
                </button>
                {job.status === "running" ? (
                  <button
                    className="secondary-action"
                    type="button"
                    disabled={workingJobId === job.id}
                    onClick={() => void runJobAction(job.id, "cancel")}
                  >
                    Cancel
                  </button>
                ) : null}
                {job.status !== "running" && job.status !== "queued" && job.status !== "pending" && job.status !== "cancel_requested" ? (
                  <button
                    className="secondary-action"
                    type="button"
                    disabled={workingJobId === job.id}
                    onClick={() => void runJobAction(job.id, "retry")}
                  >
                    Retry
                  </button>
                ) : null}
                {job.status !== "running" && job.status !== "cancel_requested" && !job.removedAt ? (
                  <button
                    className="secondary-action destructive-action"
                    type="button"
                    disabled={workingJobId === job.id}
                    onClick={() => void runJobAction(job.id, "remove")}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            </td>
          </tr>
        )}
      />

      <JobDetailsModal job={selectedJob} onClose={() => setSelectedJob(null)} />
      <JobAiInsightModal state={selectedJobAiInsight} onClose={() => setSelectedJobAiInsight(null)} />
    </div>
  );
}

function JobDetailsModal({ job, onClose }: { job: QueuedJob | null; onClose: () => void }) {
  if (!job) return null;

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-panel modal-panel-wide" aria-modal="true" aria-labelledby="job-details-title" role="dialog">
        <div className="modal-header">
          <div>
            <p className="eyebrow">Queued Job</p>
            <h3 id="job-details-title">{job.displayName}</h3>
          </div>
          <button className="modal-close" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="modal-body modal-scroll">
          <div className="jobs-overview-grid">
            <div className="detail-item"><span>Status</span><strong>{formatJobStatusLabel(job.status)}</strong></div>
            <div className="detail-item"><span>Type</span><strong>{formatJobTypeLabel(job.jobType)}</strong></div>
            <div className="detail-item"><span>Scheduled</span><strong>{formatDateTime(job.scheduledFor)}</strong></div>
            <div className="detail-item"><span>Requested By</span><strong>{job.requestedByUserName ?? "Unknown"}</strong></div>
            <div className="detail-item"><span>Started</span><strong>{formatDateTime(job.startedAt)}</strong></div>
            <div className="detail-item"><span>Completed</span><strong>{formatDateTime(job.completedAt)}</strong></div>
          </div>
          {job.errorText ? <StatusBanner kind="error" message={job.errorText} /> : null}
          <div className="jobs-json-grid">
            <div>
              <p className="eyebrow">Payload</p>
              <pre className="jobs-json-block">{JSON.stringify(job.payload, null, 2)}</pre>
            </div>
            <div>
              <p className="eyebrow">Result</p>
              <pre className="jobs-json-block">{job.result ? JSON.stringify(job.result, null, 2) : "No result yet."}</pre>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function JobAiInsightModal({ state, onClose }: { state: JobAiInsightModalState | null; onClose: () => void }) {
  if (!state) return null;

  const { job, insight } = state;
  const hasCompaniesHouseData = hasCompaniesHouseIdentification(insight.companyNumber);

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-panel modal-panel-wide" aria-modal="true" aria-labelledby="job-ai-insight-title" role="dialog">
        <div className="modal-header">
          <div>
            <p className="eyebrow">AI Company Insight Job</p>
            <h3 id="job-ai-insight-title">{job.displayName}</h3>
          </div>
          <button className="modal-close" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="modal-body modal-scroll">
          <section className="detail-panel ai-insight-summary-grid">
            <article className="detail-card">
              <p className="eyebrow">Official Identification</p>
              <h3>{insight.companyName}</h3>
              {hasCompaniesHouseData ? (
                <div className="ai-insight-inline-meta"><Hash size={14} aria-hidden /> {insight.companyNumber}</div>
              ) : (
                <p className="ai-insight-helper-copy">
                  No Companies House record was identified for this result. The business may not be a limited company, and this insight may be based on other public sources.
                </p>
              )}
            </article>
            <article className="detail-card">
              <p className="eyebrow">Live Status</p>
              <Badge text={insight.status || "Unknown"} />
              <div className="ai-insight-stack">
                {hasCompaniesHouseData ? (
                  <span><Calendar size={12} aria-hidden /> Inc: {insight.incorporationDate || ""}</span>
                ) : (
                  <span className="muted">No Companies House incorporation data was identified.</span>
                )}
                {insight.turnover ? (
                  <span><Hash size={12} aria-hidden /> Turnover: {insight.turnover}</span>
                ) : null}
                {insight.employeeCount ? (
                  <span><Users size={12} aria-hidden /> Employees: {insight.employeeCount}</span>
                ) : null}
                <span><Info size={12} aria-hidden /> {insight.natureOfBusiness || ""}</span>
              </div>
            </article>
            <article className="detail-card">
              <p className="eyebrow">Contact Info</p>
              <div className="ai-insight-stack">
                {hasCompaniesHouseData && insight.registeredAddress ? (
                  <span><MapPin size={14} aria-hidden /> {insight.registeredAddress}</span>
                ) : (
                  <span className="muted">No registered Companies House address was identified for this result.</span>
                )}
                {insight.website ? (
                  <a className="row-link" href={insight.website} target="_blank" rel="noreferrer">
                    <Globe size={14} aria-hidden /> Main Website <ExternalLink size={12} aria-hidden />
                  </a>
                ) : null}
                {(insight.digitalLinks ?? []).slice(0, 3).map((link) => (
                  <a key={link.url} className="row-link" href={link.url} target="_blank" rel="noreferrer">
                    <ExternalLink size={12} aria-hidden /> {link.label}
                  </a>
                ))}
              </div>
            </article>
          </section>
          <section className="detail-panel">
            <div className="detail-grid">
              <article className="detail-card">
                <h4>SIC Classifications</h4>
                <div className="ai-insight-chip-grid">
                  {(insight.sicCodes ?? []).map((code) => (
                    <div key={code} className="ai-insight-code-chip">
                      <strong>{code.split(" - ")[0]}</strong>
                      <span>{code.split(" - ")[1] ?? "Industrial Code"}</span>
                    </div>
                  ))}
                </div>
                <div className="ai-insight-summary-copy">
                  <p className="eyebrow">Researcher Analytics</p>
                  <p>{insight.summary}</p>
                </div>
              </article>
              <article className="detail-card">
                <h4>Management Structure</h4>
                <div className="ai-insight-director-list">
                  {(insight.directors ?? []).map((director) => (
                    <div key={`${director.name}-${director.role}`} className="ai-insight-director-row">
                      <div>
                        <strong>{director.name}</strong>
                      </div>
                      <Badge text={director.role} />
                    </div>
                  ))}
                </div>
                <div className="ai-insight-sources">
                  <p className="eyebrow">Verified Data Sources</p>
                  <div className="ai-insight-source-list">
                    {(insight.sources ?? []).map((source) => (
                      <span key={source} className="match-chip">{source}</span>
                    ))}
                  </div>
                </div>
              </article>
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}

function AiCompanyInsightView({
  state,
  onDataChanged,
  context,
  onBackToCustomer,
  onOpenJobs
}: {
  state: LoadState<AiCompanyInsight[]>;
  onDataChanged: () => void;
  context: AiInsightContext | null;
  onBackToCustomer: () => void;
  onOpenJobs: () => void;
}) {
  const [view, setView] = useState<"search" | "saved">("search");
  const [name, setName] = useState("");
  const [postcode, setPostcode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [businessData, setBusinessData] = useState<BusinessInfo | null>(null);
  const [filterText, setFilterText] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [geminiKeyState, setGeminiKeyState] = useState<LoadState<string>>({ loading: true });
  const [notice, setNotice] = useState<ArchiveNotice | null>(null);
  const [updatingCustomers, setUpdatingCustomers] = useState(false);
  const [updatingCustomerRecord, setUpdatingCustomerRecord] = useState(false);
  const [currentInsightLinkedToCustomer, setCurrentInsightLinkedToCustomer] = useState(false);
  const [queuedJobScheduledFor, setQueuedJobScheduledFor] = useState("");
  const [queueingJob, setQueueingJob] = useState(false);
  const savedInsights = state.data ?? [];

  useEffect(() => {
    if (!context) {
      return;
    }

    setName(context.tradingName ?? "");
    setPostcode(context.postcode ?? "");
    setView("search");
    setCurrentInsightLinkedToCustomer(false);
  }, [context]);

  useEffect(() => {
    setCurrentInsightLinkedToCustomer(false);
  }, [businessData?.companyNumber, businessData?.companyName]);

  useEffect(() => {
    let cancelled = false;

    async function loadGeminiKey() {
      setGeminiKeyState({ loading: true });
      try {
        const response = await fetchWithActor(`${apiBase}/api/settings/gemini`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json() as { apiKey?: string | null };
        if (!cancelled) {
          setGeminiKeyState({ data: data.apiKey ?? "", loading: false });
        }
      } catch (loadError) {
        if (!cancelled) {
          setGeminiKeyState({
            error: loadError instanceof Error ? loadError.message : "Could not load Gemini key.",
            loading: false
          });
        }
      }
    }

    void loadGeminiKey();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredSaved = useMemo(() => {
    return savedInsights.filter((item) => {
      const query = filterText.trim().toLowerCase();
      const matchesText = !query || [
        item.companyName,
        item.companyNumber,
        ...(item.insight.sicCodes ?? [])
      ].some((value) => (value ?? "").toLowerCase().includes(query));
      const normalizedStatus = (item.status ?? item.insight.status ?? "").toLowerCase();
      const matchesStatus = statusFilter === "all" ||
        (statusFilter === "active" && normalizedStatus.includes("active")) ||
        (statusFilter === "inactive" && !normalizedStatus.includes("active"));
      return matchesText && matchesStatus;
    });
  }, [filterText, savedInsights, statusFilter]);

  const isSaved = useMemo(() => {
    if (!businessData) return false;
    return savedInsights.some((item) => item.companyNumber === businessData.companyNumber);
  }, [businessData, savedInsights]);

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) return;

    const apiKey = geminiKeyState.data?.trim();
    if (!apiKey) {
      setError("Set the Gemini key in Operations -> AI Settings before running a search.");
      return;
    }

    setLoading(true);
    setError(null);
    setNotice(null);
    setBusinessData(null);
    setView("search");

    try {
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Find detailed information about the UK business named "${name}" located near postcode "${postcode}". 
        Include data from Companies House, their official website, social media profiles (LinkedIn, X/Twitter, Facebook, Instagram), and other public sources.
        Identify the main official website and list any relevant auxiliary digital links (e.g., trustpilot, glassdoor, or secondary domains).
        CRITICAL: Try to find financial highlights, specifically Turnover (Revenue) and Employee Count from recent filings or public reports.
        Specifically focus on the SIC codes, company status, and directors.
        Be precise with the Company Number and Registered Address.`,
        config: {
          tools: [{ googleSearch: {} }],
          responseMimeType: "application/json",
          responseSchema: aiBusinessSchema,
          systemInstruction: "You are a professional UK business researcher. You find accurate, up-to-date information about companies in the UK using Google Search. Always verify company numbers and SIC codes. Find as many official digital presence links as possible and always attempt to locate financial data like turnover and employee count."
        }
      });

      const parsed = JSON.parse(response.text || "{}") as BusinessInfo;
      setBusinessData(parsed);
    } catch (searchError) {
      setError("Failed to fetch business information. Please try again with more specific details.");
      console.error(searchError);
    } finally {
      setLoading(false);
    }
  }

  async function saveBusiness(data: BusinessInfo) {
    setNotice(null);
    try {
      const response = await fetchWithActor(`${apiBase}/api/ai-company-insights`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          searchName: name,
          searchLocation: postcode || null,
          insight: data
        })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await response.json();
      onDataChanged();
      setNotice({
        kind: "success",
        message: `${data.companyName} saved to database.`
      });
    } catch (saveError) {
      setNotice({
        kind: "error",
        message: saveError instanceof Error ? saveError.message : "Could not save AI company insight."
      });
    }
  }

  async function deleteSaved(insight: AiCompanyInsight) {
    setNotice(null);
    try {
      const response = await fetchWithActor(`${apiBase}/api/ai-company-insights/${insight.id}`, {
        method: "DELETE"
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      onDataChanged();
      setNotice({ kind: "success", message: `${insight.companyName} removed from archive.` });
      if (businessData?.companyNumber === insight.companyNumber) {
        setBusinessData(null);
      }
    } catch (deleteError) {
      setNotice({
        kind: "error",
        message: deleteError instanceof Error ? deleteError.message : "Could not remove AI company insight."
      });
    }
  }

  async function updateMatchingCustomers(data: BusinessInfo) {
    setUpdatingCustomers(true);
    setNotice(null);
    try {
      const response = await fetchWithActor(`${apiBase}/api/ai-company-insights/apply-to-customers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          searchName: name || data.companyName,
          searchLocation: postcode || null,
          insight: data
        })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json() as { matchedCustomers: number; addedLinks: number };
      setNotice({
        kind: "success",
        message: payload.matchedCustomers
          ? `Updated ${payload.matchedCustomers} matching customer(s). Added ${payload.addedLinks} business type link(s).`
          : "No matching customers were found."
      });
      onDataChanged();
    } catch (applyError) {
      setNotice({
        kind: "error",
        message: applyError instanceof Error ? applyError.message : "Could not update matching customers."
      });
    } finally {
      setUpdatingCustomers(false);
    }
  }

  async function linkCurrentInsightToCustomer(data: BusinessInfo) {
    if (!context?.customerId) {
      return;
    }

    setUpdatingCustomerRecord(true);
    setNotice(null);
    try {
      const response = await fetchWithActor(`${apiBase}/api/ai-company-insights`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          searchName: name || context.tradingName || context.customerLabel || data.companyName,
          searchLocation: postcode || null,
          insight: data,
          customerId: context.customerId
        })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await response.json();
      onDataChanged();
      setCurrentInsightLinkedToCustomer(true);
      setNotice({
        kind: "success",
        message: `${context.customerLabel ?? "Customer"} linked to the current AI insight record.`
      });
    } catch (updateError) {
      setNotice({
        kind: "error",
        message: updateError instanceof Error ? updateError.message : "Could not link the current AI insight to the customer."
      });
    } finally {
      setUpdatingCustomerRecord(false);
    }
  }

  async function queueInsightJob() {
    if (!name.trim()) {
      setError("Enter a business name before creating a queued job.");
      return;
    }

    setQueueingJob(true);
    setNotice(null);
    setError(null);

    try {
      const response = await fetchWithActor(`${apiBase}/api/jobs/ai-company-insight`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          searchName: name.trim(),
          searchLocation: postcode.trim() || null,
          scheduledFor: queuedJobScheduledFor || null,
          customerId: context?.customerId ?? null,
          saveToDatabase: true
        })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? `HTTP ${response.status}`);
      }

      setNotice({
        kind: "success",
        message: queuedJobScheduledFor
          ? "Queued AI company insight job scheduled."
          : "Queued AI company insight job created."
      });
    } catch (queueError) {
      setNotice({
        kind: "error",
        message: queueError instanceof Error ? queueError.message : "Could not create the queued AI company insight job."
      });
    } finally {
      setQueueingJob(false);
    }
  }

  function exportInsight(data: BusinessInfo) {
    const fileName = `${data.companyName.replace(/[^a-z0-9]/gi, "_").toLowerCase()}_insight.json`;
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  const hasCompaniesHouseData = businessData ? hasCompaniesHouseIdentification(businessData.companyNumber) : false;

  return (
    <div className="ai-insight-page">
      {notice && <StatusBanner kind={notice.kind} message={notice.message} />}
      {geminiKeyState.error && <StatusBanner kind="error" message={geminiKeyState.error} />}

      <section className="ai-insight-hero">
        <div className="ai-insight-title">
          <div className="ai-insight-brand">
            <Building2 size={28} aria-hidden />
            <span>UK Business Intelligence</span>
          </div>
          <h3>Insight Explorer</h3>
        </div>
        <div className="ai-insight-nav">
          {context?.customerId ? (
            <button className="secondary-action" type="button" onClick={onBackToCustomer}>
              <ArrowLeft size={14} aria-hidden /> Back to Customer
            </button>
          ) : null}
          <button className="secondary-action" type="button" onClick={onOpenJobs}>
            Jobs
          </button>
          <button className={view === "search" ? "page-action-button" : "secondary-action"} type="button" onClick={() => setView("search")}>
            Search Tool
          </button>
          <button className={view === "saved" ? "page-action-button" : "secondary-action"} type="button" onClick={() => setView("saved")}>
            Database {savedInsights.length ? `(${savedInsights.length})` : ""}
          </button>
        </div>
      </section>

      {view === "search" ? (
        <>
          {context?.customerId ? (
            <section className="detail-panel compact-panel">
              <div className="detail-header detail-header-inline">
                <div>
                  <p className="eyebrow">Customer Context</p>
                  <h3>{context.customerLabel ?? "Customer"}</h3>
                  <p className="muted">Trading name on customer: {context.tradingName || "None"}</p>
                </div>
                <div className="panel-actions">
                  {businessData ? (
                    <>
                      <button
                        className="page-action-button ai-link-customer-button"
                        type="button"
                        disabled={updatingCustomerRecord}
                        onClick={() => void linkCurrentInsightToCustomer(businessData)}
                      >
                        {updatingCustomerRecord ? "Linking..." : "Link to Customer"}
                      </button>
                      {currentInsightLinkedToCustomer ? (
                        <span className="ai-link-customer-status">Insight linked to this customer</span>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </div>
              <p className="muted">
                Search uses the text in the Business Name box. Linking uses this customer record directly.
              </p>
            </section>
          ) : null}
          <section className="detail-panel ai-insight-search-panel">
            <form className="ai-insight-search-form" onSubmit={(event) => void handleSearch(event)}>
              <div className="table-search">
                <label htmlFor="ai-company-name">Business Name</label>
                <input
                  id="ai-company-name"
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="e.g. Acme Services Ltd"
                  required
                />
              </div>
              <div className="table-search">
                <label htmlFor="ai-company-postcode">Address / Postcode</label>
                <input
                  id="ai-company-postcode"
                  type="text"
                  value={postcode}
                  onChange={(event) => setPostcode(event.target.value)}
                  placeholder="e.g. SW1A 1AA"
                />
              </div>
              <div className="page-actions">
                <button className="page-action-button" type="submit" disabled={loading || geminiKeyState.loading}>
                  {loading ? <><Loader2 size={16} className="spin" /> Searching</> : "Search"}
                </button>
              </div>
            </form>
            <div className="ai-job-schedule-row">
              <div className="table-search">
                <label htmlFor="ai-company-scheduled-for">Schedule for</label>
                <input
                  id="ai-company-scheduled-for"
                  type="datetime-local"
                  value={queuedJobScheduledFor}
                  onChange={(event) => setQueuedJobScheduledFor(event.target.value)}
                />
              </div>
              <div className="page-actions">
                <button className="secondary-action" type="button" disabled={queueingJob} onClick={() => void queueInsightJob()}>
                  {queueingJob ? "Creating Job..." : "Create queued job"}
                </button>
              </div>
            </div>
          </section>

          {loading && <PanelSkeleton />}
          {error && <ErrorPanel error={error} />}

          {!loading && !error && businessData && (
            <>
              <section className="detail-panel ai-insight-actions">
                <div className="panel-actions">
                  <button className="secondary-action" type="button" onClick={() => exportInsight(businessData)}>
                    <Download size={14} aria-hidden /> Download JSON
                  </button>
                  <button className={isSaved ? "page-action-button" : "secondary-action"} type="button" disabled={isSaved} onClick={() => void saveBusiness(businessData)}>
                    {isSaved ? <><BookmarkCheck size={14} aria-hidden /> Saved to Database</> : <><Bookmark size={14} aria-hidden /> Save to Database</>}
                  </button>
                  {!context?.customerId ? (
                    <button className="secondary-action" type="button" disabled={updatingCustomers} onClick={() => void updateMatchingCustomers(businessData)}>
                      {updatingCustomers ? "Updating Customers..." : "Update Any Customers that Match"}
                    </button>
                  ) : null}
                </div>
              </section>

              <section className="detail-panel ai-insight-summary-grid">
                <article className="detail-card">
                  <p className="eyebrow">Official Identification</p>
                  <h3>{businessData.companyName}</h3>
                  {hasCompaniesHouseData ? (
                    <div className="ai-insight-inline-meta"><Hash size={14} aria-hidden /> {businessData.companyNumber}</div>
                  ) : (
                    <p className="ai-insight-helper-copy">
                      No Companies House record was identified for this result. The business may not be a limited company, and this insight may be based on other public sources.
                    </p>
                  )}
                </article>
                <article className="detail-card">
                  <p className="eyebrow">Live Status</p>
                  <Badge text={businessData.status || "Unknown"} />
                  <div className="ai-insight-stack">
                    {hasCompaniesHouseData ? (
                      <span><Calendar size={12} aria-hidden /> Inc: {businessData.incorporationDate || ""}</span>
                    ) : (
                      <span className="muted">No Companies House incorporation data was identified.</span>
                    )}
                    {businessData.turnover ? (
                      <span><Hash size={12} aria-hidden /> Turnover: {businessData.turnover}</span>
                    ) : null}
                    {businessData.employeeCount ? (
                      <span><Users size={12} aria-hidden /> Employees: {businessData.employeeCount}</span>
                    ) : null}
                    <span><Info size={12} aria-hidden /> {businessData.natureOfBusiness || ""}</span>
                  </div>
                </article>
                <article className="detail-card">
                  <p className="eyebrow">Contact Info</p>
                  <div className="ai-insight-stack">
                    {hasCompaniesHouseData && businessData.registeredAddress ? (
                      <span><MapPin size={14} aria-hidden /> {businessData.registeredAddress}</span>
                    ) : (
                      <span className="muted">No registered Companies House address was identified for this result.</span>
                    )}
                    {businessData.website ? (
                      <a className="row-link" href={businessData.website} target="_blank" rel="noreferrer">
                        <Globe size={14} aria-hidden /> Main Website <ExternalLink size={12} aria-hidden />
                      </a>
                    ) : null}
                  </div>
                </article>
              </section>

              <section className="detail-panel">
                <div className="detail-grid">
                  <article className="detail-card">
                    <h4>SIC Classifications</h4>
                    <div className="ai-insight-chip-grid">
                      {(businessData.sicCodes ?? []).map((code) => (
                        <div key={code} className="ai-insight-code-chip">
                          <strong>{code.split(" - ")[0]}</strong>
                          <span>{code.split(" - ")[1] ?? "Industrial Code"}</span>
                        </div>
                      ))}
                    </div>
                    <div className="ai-insight-summary-copy">
                      <p className="eyebrow">Researcher Analytics</p>
                      <p>{businessData.summary}</p>
                    </div>
                  </article>
                  <article className="detail-card">
                    <h4>Management Structure</h4>
                    <div className="ai-insight-director-list">
                      {(businessData.directors ?? []).map((director) => (
                        <div key={`${director.name}-${director.role}`} className="ai-insight-director-row">
                          <div>
                            <strong>{director.name}</strong>
                          </div>
                          <Badge text={director.role} />
                        </div>
                      ))}
                    </div>
                    <div className="ai-insight-sources">
                      <p className="eyebrow">Verified Data Sources</p>
                      <div className="ai-insight-source-list">
                        {(businessData.sources ?? []).map((source) => (
                          <span key={source} className="match-chip">{source}</span>
                        ))}
                      </div>
                    </div>
                  </article>
                </div>
              </section>
            </>
          )}

          {!loading && !error && !businessData && (
            <EmptyPanel message="Awaiting search query." />
          )}
        </>
      ) : (
        <>
          <section className="detail-panel ai-insight-archive-toolbar">
            <div className="table-search">
              <label htmlFor="ai-insight-filter-text">Filter Database</label>
              <input
                id="ai-insight-filter-text"
                type="search"
                placeholder="Filter by name, number, SIC..."
                value={filterText}
                onChange={(event) => setFilterText(event.target.value)}
              />
            </div>
            <div className="table-filter-actions">
              <button className={statusFilter === "all" ? "page-action-button" : "secondary-action"} type="button" onClick={() => setStatusFilter("all")}>
                All
              </button>
              <button className={statusFilter === "active" ? "page-action-button" : "secondary-action"} type="button" onClick={() => setStatusFilter("active")}>
                Active Only
              </button>
              <button className={statusFilter === "inactive" ? "page-action-button" : "secondary-action"} type="button" onClick={() => setStatusFilter("inactive")}>
                Inactive
              </button>
            </div>
          </section>

          {state.loading ? <PanelSkeleton /> : state.error ? <ErrorPanel error={state.error} /> : (
            filteredSaved.length === 0 ? (
              <EmptyPanel message={savedInsights.length ? "No matching records found." : "Database is currently empty."} />
            ) : (
              <section className="ai-insight-card-grid">
                {filteredSaved.map((item) => (
                  <article key={item.id} className="detail-card ai-insight-card">
                    <div className="ai-insight-card-header">
                      <span className="badge mono">{item.companyNumber}</span>
                      <div className="ai-insight-card-actions">
                        <button className="secondary-action" type="button" onClick={() => exportInsight(item.insight)}>
                          <Download size={14} aria-hidden /> Download
                        </button>
                        <button
                          className="secondary-action"
                          type="button"
                          onClick={() => {
                            setBusinessData(item.insight);
                            setName(item.searchName);
                            setPostcode(item.searchLocation ?? "");
                            setView("search");
                          }}
                        >
                          <ArrowRight size={14} aria-hidden /> Open
                        </button>
                      </div>
                    </div>
                    <h4>{item.companyName}</h4>
                    <p className="muted">{formatDateTime(item.updatedAt)}</p>
                    <div className="ai-insight-stack">
                      <span><MapPin size={12} aria-hidden /> {item.insight.registeredAddress}</span>
                      {item.insight.turnover ? (
                        <span><Hash size={12} aria-hidden /> {item.insight.turnover}</span>
                      ) : null}
                      {item.insight.employeeCount ? (
                        <span><Users size={12} aria-hidden /> {item.insight.employeeCount}</span>
                      ) : null}
                      <span><Info size={12} aria-hidden /> {item.insight.natureOfBusiness}</span>
                    </div>
                    <div className="ai-insight-source-list">
                      {(item.insight.sicCodes ?? []).slice(0, 3).map((sic) => (
                        <span key={sic} className="match-chip">{sic.split(" - ")[0]}</span>
                      ))}
                    </div>
                    <div className="ai-insight-card-delete-row">
                      <button className="secondary-action destructive-action" type="button" onClick={() => void deleteSaved(item)}>
                        <Trash2 size={14} aria-hidden /> Delete
                      </button>
                    </div>
                  </article>
                ))}
              </section>
            )
          )}

          <section className="ai-insight-footer-actions">
            <button className="secondary-action" type="button" onClick={() => setView("search")}>
              <ArrowLeft size={12} aria-hidden /> Back to Investigation
            </button>
          </section>
        </>
      )}
    </div>
  );
}

function SearchRunsView({ state }: { state: LoadState<SearchRun[]> }) {
  return (
    <DataTable
      state={state}
      emptyMessage="No search runs have been captured yet."
      columns={["Query", "Counts", "Executed", "Source"]}
      renderRow={(row) => (
        <tr key={row.id}>
          <td>{row.queryText}</td>
          <td className="mono">{row.countsJson}</td>
          <td>{formatDateTime(row.executedAt)}</td>
          <td className="truncate">{row.sourceUrl ?? ""}</td>
        </tr>
      )}
    />
  );
}

function ProspectsView({
  state,
  onDataChanged,
  viewState,
  onViewStateChange
}: {
  state: LoadState<Prospect[]>;
  onDataChanged: () => void;
  viewState: ProspectPageViewState;
  onViewStateChange: Dispatch<SetStateAction<ProspectPageViewState>>;
}) {
  const [detailState, setDetailState] = useState<LoadState<ProspectDetail>>({ loading: false });
  const [selectedProspectId, setSelectedProspectId] = useState("");
  const [storedDetailIds, setStoredDetailIds] = useState<Set<string>>(() => new Set());
  const [batchState, setBatchState] = useState<BatchFetchState>({
    open: false,
    running: false,
    completed: false,
    total: 0,
    completedCount: 0,
    successCount: 0,
    failedCount: 0
  });

  async function loadProspectDetail(prospectId: string) {
    if (selectedProspectId === prospectId && detailState.data) {
      setSelectedProspectId("");
      setDetailState({ loading: false });
      return;
    }

    setSelectedProspectId(prospectId);
    setDetailState({ loading: true });

    try {
      const response = await fetchWithActor(`${apiBase}/api/test/prospect-detail/${encodeURIComponent(prospectId)}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as ProspectDetail;
      setDetailState({ data, loading: false });
      setStoredDetailIds((current) => new Set(current).add(prospectId));
      onDataChanged();
    } catch (error) {
      setDetailState({
        error: error instanceof Error ? error.message : "Could not load prospect detail.",
        loading: false
      });
    }
  }

  function handleSort(nextKey: ProspectPageSortKey) {
    if (viewState.sortKey === nextKey) {
      onViewStateChange((current) => ({
        ...current,
        sortDirection: current.sortDirection === "asc" ? "desc" : "asc"
      }));
      return;
    }

    onViewStateChange((current) => ({
      ...current,
      sortKey: nextKey,
      sortDirection: "asc"
    }));
  }

  const sortedData = state.data
    ? [...state.data]
        .filter((row) => {
          const query = viewState.searchText.trim().toLowerCase();
          if (!query) return true;

          const baseFields = [
            row.prospectId,
            row.businessName,
            row.contactName,
            row.contactEmail,
            row.postcode
          ];

          const detailFields = viewState.searchDetails
            ? [
                row.channel,
                row.origin,
                row.addressLine1,
                row.town,
                row.county,
                row.contactPhone
              ]
            : [];

          return [...baseFields, ...detailFields]
            .filter(Boolean)
            .some((value) => value!.toLowerCase().includes(query));
        })
        .sort((left, right) =>
          compareValues(
            getProspectPageSortValue(left, viewState.sortKey),
            getProspectPageSortValue(right, viewState.sortKey),
            viewState.sortDirection
          )
        )
    : state.data;
  const missingDetailRows = state.data?.filter((row) => !row.hasStoredDetail && !storedDetailIds.has(row.prospectId)) ?? [];

  function openBatchModal() {
    setBatchState({
      open: true,
      running: false,
      completed: false,
      total: missingDetailRows.length,
      completedCount: 0,
      successCount: 0,
      failedCount: 0
    });
  }

  function closeBatchModal() {
    if (batchState.running) return;
    setBatchState({
      open: false,
      running: false,
      completed: false,
      total: 0,
      completedCount: 0,
      successCount: 0,
      failedCount: 0
    });
  }

  async function runBatchFetch() {
    const targets = [...missingDetailRows];
    setBatchState({
      open: true,
      running: true,
      completed: false,
      total: targets.length,
      completedCount: 0,
      successCount: 0,
      failedCount: 0
    });

    if (!targets.length) {
      setBatchState({
        open: true,
        running: false,
        completed: true,
        total: 0,
        completedCount: 0,
        successCount: 0,
        failedCount: 0
      });
      return;
    }

    let successCount = 0;
    let failedCount = 0;

    for (const row of targets) {
      setBatchState((current) => ({
        ...current,
        currentProspectId: row.prospectId
      }));

      try {
        const response = await fetchWithActor(`${apiBase}/api/test/prospect-detail/${encodeURIComponent(row.prospectId)}`);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        await response.json();
        successCount += 1;
        setStoredDetailIds((current) => new Set(current).add(row.prospectId));
        onDataChanged();
      } catch {
        failedCount += 1;
      }

      setBatchState((current) => ({
        ...current,
        completedCount: current.completedCount + 1,
        successCount,
        failedCount
      }));
    }

    setBatchState((current) => ({
      ...current,
      running: false,
      completed: true,
      currentProspectId: undefined
    }));
  }

  return (
    <>
      <section className="table-controls">
        <div className="table-search">
          <label htmlFor="prospect-page-search">Search prospects</label>
          <input
            id="prospect-page-search"
            type="search"
            value={viewState.searchText}
            onChange={(event) => onViewStateChange((current) => ({ ...current, searchText: event.target.value }))}
            placeholder={viewState.searchDetails ? "Prospect, contact, postcode, or stored detail" : "Prospect, contact, or postcode"}
          />
        </div>
        <div className="table-filter-actions">
          <label className="header-filter">
            <input
              type="checkbox"
              checked={viewState.searchDetails}
              onChange={(event) => onViewStateChange((current) => ({ ...current, searchDetails: event.target.checked }))}
            />
            <span>Search details</span>
          </label>
          <button
            className="secondary-action"
            type="button"
            onClick={() =>
              onViewStateChange({
                searchText: "",
                searchDetails: false,
                sortKey: "addedAt",
                sortDirection: "desc"
              })
            }
          >
            Reset
          </button>
        </div>
      </section>
      <section className="page-actions">
        <button
          className="page-action-button"
          type="button"
          disabled={state.loading || !state.data?.length}
          onClick={openBatchModal}
        >
          Fetch Missing Details
        </button>
        <span className="page-action-note">
          {missingDetailRows.length} prospect row{missingDetailRows.length === 1 ? "" : "s"} without stored detail
        </span>
      </section>
      <DataTable
        state={state.data ? { ...state, data: sortedData } : state}
        emptyMessage="No hardened prospects have been saved yet."
        columns={[
          "Action",
          "Prospect",
          renderSortHeader("Added", viewState.sortKey === "addedAt", viewState.sortDirection, () => handleSort("addedAt")),
          renderSortHeader("Business", viewState.sortKey === "businessName", viewState.sortDirection, () => handleSort("businessName")),
          renderSortHeader("Contact", viewState.sortKey === "contactName", viewState.sortDirection, () => handleSort("contactName")),
          "Email",
          "Owner",
          renderSortHeader("Postcode", viewState.sortKey === "postcode", viewState.sortDirection, () => handleSort("postcode")),
          "Flag"
        ]}
        renderRow={(row) => (
          <Fragment key={row.id}>
            <tr className={getLeadLinkedRowClassName(row.prospectId === selectedProspectId, row.hasLead)}>
              <td>
                <button className="details-button" type="button" onClick={() => void loadProspectDetail(row.prospectId)}>
                  {row.hasStoredDetail || storedDetailIds.has(row.prospectId) ? "Show" : "Details"}
                </button>
              </td>
              <td className="mono">{row.prospectId}</td>
              <td>{formatDateTime(row.addedAt)}</td>
              <td>{row.businessName}</td>
              <td>{row.contactName ?? ""}</td>
              <td><CopyableEmail email={row.contactEmail} /></td>
              <td>{row.ownerName ?? ""}</td>
              <td className="mono">{row.postcode ?? ""}</td>
              <td>{row.hasPaymentsenseCustomerMatch ? <Badge text="PS match" /> : ""}</td>
            </tr>
            {row.prospectId === selectedProspectId && (
              <InlineProspectDetailRow colspan={9} detailState={detailState} />
            )}
          </Fragment>
        )}
      />
      <BatchFetchModal
        state={batchState}
        onClose={closeBatchModal}
        onConfirm={() => void runBatchFetch()}
      />
    </>
  );
}

function CustomerSplitActionButton({
  customer,
  users,
  bookmarkDotColor,
  showBookmarkDot,
  savingAssignedUserCustomerId,
  openActionCustomerId,
  onToggleOpenActionCustomerId,
  onPrimaryAction,
  onAssignUser,
  onOpenNotes,
  onScheduleAiInsight,
  onFilterCustomersByEntity,
  onFilterCustomersByTradingName,
  onToggleBookmark,
  onClearBookmarks,
  onArchive,
  primaryLabel
}: {
  customer: Customer;
  users: User[];
  bookmarkDotColor?: string | null;
  showBookmarkDot: boolean;
  savingAssignedUserCustomerId: number | null;
  openActionCustomerId: number | null;
  onToggleOpenActionCustomerId: Dispatch<SetStateAction<number | null>>;
  onPrimaryAction: () => void;
  onAssignUser: (customer: Customer, assignedUserId: string) => Promise<void>;
  onOpenNotes: (customer: Customer) => Promise<void>;
  onScheduleAiInsight?: (customer: Customer) => Promise<void>;
  onFilterCustomersByEntity?: (customer: Customer) => void;
  onFilterCustomersByTradingName?: (customer: Customer) => void;
  onToggleBookmark: (customer: Customer) => Promise<void>;
  onClearBookmarks: () => Promise<void>;
  onArchive: (customer: Customer) => Promise<void>;
  primaryLabel: string;
}) {
  return (
    <div className="split-button">
      <button className="details-button" type="button" onClick={onPrimaryAction}>
        {showBookmarkDot && (
          <span
            className="bookmark-dot"
            aria-hidden
            style={bookmarkDotColor ? { backgroundColor: bookmarkDotColor } : undefined}
          />
        )}
        {primaryLabel}
      </button>
      <button
        className="details-button split-button-toggle"
        type="button"
        aria-label={`More actions for ${customer.customerRef ?? customer.entityName}`}
        onClick={() => onToggleOpenActionCustomerId((current) => current === customer.id ? null : customer.id)}
      >
        <ChevronDown size={14} aria-hidden />
      </button>
      {openActionCustomerId === customer.id && (
        <div className="row-action-menu">
          <div className="row-action-menu-section">
            <span className="row-action-menu-label">Assign to</span>
            <select
              className="header-select"
              value={customer.assignedUserId ? String(customer.assignedUserId) : ""}
              disabled={savingAssignedUserCustomerId === customer.id}
              onChange={(event) => void onAssignUser(customer, event.target.value)}
            >
              <option value="">Unassigned</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.fullName}
                </option>
              ))}
            </select>
          </div>
          <div className="row-action-menu-inline-actions">
            <button className="secondary-action" type="button" onClick={() => void onOpenNotes(customer)}>
              Notes
            </button>
            {!customer.hasAiInsight && !customer.hasAiInsightJobScheduled && onScheduleAiInsight && (
              <button className="secondary-action" type="button" onClick={() => void onScheduleAiInsight(customer)}>
                Schedule AI Insight
              </button>
            )}
            {!customer.hasAiInsight && customer.hasAiInsightJobScheduled ? (
              <span className="scheduled-insight-badge">Insight Scheduled</span>
            ) : null}
          </div>
          {(onFilterCustomersByEntity || (onFilterCustomersByTradingName && customer.tradingName)) && (
            <div className="row-action-menu-inline-actions">
              {onFilterCustomersByEntity && (
                <button className="secondary-action" type="button" onClick={() => onFilterCustomersByEntity(customer)}>
                  Filter by Entity
                </button>
              )}
              {onFilterCustomersByTradingName && customer.tradingName && (
                <button className="secondary-action" type="button" onClick={() => onFilterCustomersByTradingName(customer)}>
                  Filter by Trading Name
                </button>
              )}
            </div>
          )}
          <div className="row-action-menu-bookmark-actions">
            <button className="secondary-action" type="button" onClick={() => void onToggleBookmark(customer)}>
              {customer.isBookmarked ? "Remove Bookmark" : "Bookmark"}
            </button>
            <button className="secondary-action" type="button" onClick={() => void onClearBookmarks()}>
              Clear All Bookmarks
            </button>
          </div>
          <button className="secondary-action destructive-action" type="button" onClick={() => void onArchive(customer)}>
            Archive
          </button>
        </div>
      )}
    </div>
  );
}

function CustomerRowContextMenu({
  state,
  onClose,
  onToggleBookmark,
  canAssignToCurrentUser,
  onAssignToCurrentUser,
  onCopyEntityName,
  onCopyTradingName,
  onCopyPostcode,
  showListOptionsToggle = false,
  listOptionsHidden = false,
  onToggleListOptions
}: {
  state: CustomerRowContextMenuState | null;
  onClose: () => void;
  onToggleBookmark: (customer: Customer) => Promise<void>;
  canAssignToCurrentUser: boolean;
  onAssignToCurrentUser: (customer: Customer) => Promise<void>;
  onCopyEntityName: (customer: Customer) => Promise<void>;
  onCopyTradingName: (customer: Customer) => Promise<void>;
  onCopyPostcode: (customer: Customer) => Promise<void>;
  showListOptionsToggle?: boolean;
  listOptionsHidden?: boolean;
  onToggleListOptions?: () => void;
}) {
  useEffect(() => {
    if (!state) {
      return;
    }

    function dismiss() {
      onClose();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("mousedown", dismiss);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("mousedown", dismiss);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, state]);

  if (!state) {
    return null;
  }

  const customer = state.customer;
  const canCopyTradingName = Boolean(customer.tradingName?.trim());
  const canCopyPostcode = Boolean(customer.postcode?.trim());

  return (
    <div
      className="customer-context-menu"
      style={{ left: state.x, top: state.y }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <button
        className="customer-context-menu-button"
        type="button"
        title={customer.isBookmarked ? "Remove bookmark" : "Bookmark"}
        onClick={() => {
          void onToggleBookmark(customer);
          onClose();
        }}
      >
        {customer.isBookmarked ? <BookmarkCheck size={16} aria-hidden /> : <Bookmark size={16} aria-hidden />}
      </button>
      <button
        className="customer-context-menu-button"
        type="button"
        title="Copy entity name"
        onClick={() => {
          void onCopyEntityName(customer);
          onClose();
        }}
      >
        <Copy size={16} aria-hidden />
        <span>Entity</span>
      </button>
      <button
        className="customer-context-menu-button"
        type="button"
        title={canCopyTradingName ? "Copy trading name" : "No trading name"}
        disabled={!canCopyTradingName}
        onClick={() => {
          void onCopyTradingName(customer);
          onClose();
        }}
      >
        <Copy size={16} aria-hidden />
        <span>Trading</span>
      </button>
      <button
        className="customer-context-menu-button"
        type="button"
        title={canCopyPostcode ? "Copy postcode" : "No postcode"}
        disabled={!canCopyPostcode}
        onClick={() => {
          void onCopyPostcode(customer);
          onClose();
        }}
      >
        <Copy size={16} aria-hidden />
        <span>Postcode</span>
      </button>
      <button
        className="customer-context-menu-button"
        type="button"
        title={canAssignToCurrentUser ? "Assign to current user" : "Current user is unknown"}
        disabled={!canAssignToCurrentUser}
        onClick={() => {
          void onAssignToCurrentUser(customer);
          onClose();
        }}
      >
        <Users size={16} aria-hidden />
        <span>Assign me</span>
      </button>
      {showListOptionsToggle && onToggleListOptions ? (
        <button
          className="customer-context-menu-button"
          type="button"
          title={listOptionsHidden ? "Show list options" : "Hide list options"}
          onClick={() => {
            onToggleListOptions();
            onClose();
          }}
        >
          {listOptionsHidden ? <Eye size={16} aria-hidden /> : <EyeOff size={16} aria-hidden />}
          <span>{listOptionsHidden ? "Show Options" : "Hide Options"}</span>
        </button>
      ) : null}
    </div>
  );
}

function CustomerGeographyView({
  regions,
  customerActivityStatuses,
  customerValueTypes,
  users,
  viewState,
  onViewStateChange,
  savedMapIdToLoad,
  onSavedMapLoaded,
  leadRowsToLoad,
  onLeadRowsLoaded,
  onSavedMapsChanged
}: {
  regions: Region[];
  customerActivityStatuses: CustomerActivityStatusOption[];
  customerValueTypes: CustomerValueType[];
  users: User[];
  viewState: CustomerPageViewState;
  onViewStateChange: Dispatch<SetStateAction<CustomerPageViewState>>;
  savedMapIdToLoad: number | null;
  onSavedMapLoaded: () => void;
  leadRowsToLoad: Lead[] | null;
  onLeadRowsLoaded: () => void;
  onSavedMapsChanged: () => void;
}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [state, setState] = useState<LoadState<CustomerMapPage>>({ loading: true });
  const [selectedMapRows, setSelectedMapRows] = useState<Record<number, CustomerMapRow>>(() => ({}));
  const [coordinateOverrides, setCoordinateOverrides] = useState<Record<number, Pick<CustomerMapRow, "latitude" | "longitude" | "geocodeAccuracy" | "geocodeStatus">>>({});
  const [mappingIds, setMappingIds] = useState<Set<number>>(() => new Set());
  const [notice, setNotice] = useState<ArchiveNotice | null>(null);
  const [currentSavedMap, setCurrentSavedMap] = useState<SavedCustomerMapDetail | null>(null);
  const [mapSelectionSource, setMapSelectionSource] = useState<"customers" | "leads">("customers");
  const [mapExpanded, setMapExpanded] = useState(false);
  const [saveMapModalOpen, setSaveMapModalOpen] = useState(false);
  const [saveMapName, setSaveMapName] = useState("");
  const [savingMap, setSavingMap] = useState(false);
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const leafletMapRef = useRef<L.Map | null>(null);
  const markerLayerRef = useRef<L.LayerGroup | null>(null);
  const pulseTimerRef = useRef<number | null>(null);
  const [pulsingCustomerId, setPulsingCustomerId] = useState<number | null>(null);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
    if (viewState.searchText.trim()) params.set("searchText", viewState.searchText.trim());
    if (viewState.postcodeText?.trim()) params.set("postcodeText", viewState.postcodeText.trim());
    if (viewState.regionId) params.set("regionId", viewState.regionId);
    if (viewState.customerActivityStatusId) params.set("customerActivityStatusId", viewState.customerActivityStatusId);
    if (viewState.customerValueTypeId) {
      if (viewState.customerValueTypeId === "__unassigned__") params.set("unassignedCustomerValue", "true");
      else params.set("customerValueTypeId", viewState.customerValueTypeId);
    }
    if (viewState.assignedUserId) {
      if (viewState.assignedUserId === "__unassigned__") params.set("unassignedUser", "true");
      else params.set("assignedUserId", viewState.assignedUserId);
    }
    if (viewState.onlyBookmarked) params.set("onlyBookmarked", "true");
    if (viewState.onlyCancelled) params.set("onlyCancelled", "true");
    if (viewState.onlyMatched) params.set("onlyMatched", "true");
    if (viewState.addedFrom && viewState.addedFrom !== "all") params.set("leadPriority", viewState.addedFrom);
    params.set("sortKey", viewState.sortKey);
    params.set("sortDirection", viewState.sortDirection);
    return params.toString();
  }, [page, pageSize, viewState]);

  useEffect(() => {
    const controller = new AbortController();
    setState((current) => ({ data: current.data, loading: true }));
    fetchWithActor(`${apiBase}/api/customer-map/customers?${queryString}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json() as CustomerMapPage;
      })
      .then((data) => setState({ data, loading: false }))
      .catch((error) => {
        if (controller.signal.aborted) return;
        setState({ error: error instanceof Error ? error.message : "Could not load customer map rows.", loading: false });
      });
    return () => controller.abort();
  }, [queryString]);

  useEffect(() => {
    if (!mapElementRef.current || leafletMapRef.current) return;

    const map = L.map(mapElementRef.current, { scrollWheelZoom: true }).setView([54.5, -3.2], 6);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19
    }).addTo(map);
    const markerLayer = L.layerGroup().addTo(map);
    leafletMapRef.current = map;
    markerLayerRef.current = markerLayer;

    return () => {
      if (pulseTimerRef.current) window.clearTimeout(pulseTimerRef.current);
      map.remove();
      leafletMapRef.current = null;
      markerLayerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = leafletMapRef.current;
    if (!map) return;
    window.setTimeout(() => map.invalidateSize(), 80);
    window.setTimeout(() => map.invalidateSize(), 260);
  }, [mapExpanded]);

  useEffect(() => {
    const saved = window.localStorage.getItem("matchlab.geography.selection");
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as Record<number, CustomerMapRow>;
      setSelectedMapRows(parsed ?? {});
      const savedSource = window.localStorage.getItem("matchlab.geography.selectionSource");
      if (savedSource === "leads" || savedSource === "customers") setMapSelectionSource(savedSource);
    } catch {
      window.localStorage.removeItem("matchlab.geography.selection");
      window.localStorage.removeItem("matchlab.geography.selectionSource");
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("matchlab.geography.selection", JSON.stringify(selectedMapRows));
    window.localStorage.setItem("matchlab.geography.selectionSource", mapSelectionSource);
  }, [selectedMapRows, mapSelectionSource]);

  useEffect(() => {
    if (!savedMapIdToLoad) return;
    let cancelled = false;
    fetchWithActor(`${apiBase}/api/customer-map/saved/${savedMapIdToLoad}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json() as SavedCustomerMapDetail;
      })
      .then(async (map) => {
        if (cancelled) return;
        setCurrentSavedMap(map);
        setMapSelectionSource("customers");
        const nextRows: Record<number, CustomerMapRow> = {};
        for (const customerId of map.customerIds) {
          nextRows[customerId] = {
            id: customerId,
            addedAt: "",
            entityName: `Customer ${customerId}`,
            isBookmarked: false,
            hasStoredMatches: false
          };
        }
        setSelectedMapRows(nextRows);
        await geocodeRows(map.customerIds);
        setNotice({ kind: "success", message: `${map.name} loaded.` });
        onSavedMapLoaded();
      })
      .catch((error) => {
        if (!cancelled) {
          setNotice({ kind: "error", message: error instanceof Error ? error.message : "Could not load saved map." });
          onSavedMapLoaded();
        }
      });
    return () => {
      cancelled = true;
    };
  }, [savedMapIdToLoad]);

  useEffect(() => {
    if (!leadRowsToLoad?.length) return;

    const nextRows: Record<number, CustomerMapRow> = {};
    for (const lead of leadRowsToLoad) {
      nextRows[lead.customerId] = {
        id: lead.customerId,
        customerRef: lead.customerRef,
        mid: lead.mid,
        addedAt: lead.createdAt,
        entityName: lead.customerName,
        tradingName: lead.tradingName,
        tradingAddress: lead.tradingAddress,
        postcode: lead.postcode,
        status: lead.leadStatus,
        regionId: lead.regionId,
        regionName: lead.regionName,
        customerActivityStatusId: lead.customerActivityStatusId,
        customerActivityStatusName: lead.customerActivityStatusName,
        customerValueTypeId: lead.customerValueTypeId,
        customerValueTypeLabel: lead.customerValueTypeLabel,
        assignedUserId: lead.assignedUserId,
        assignedUserName: lead.assignedUserName,
        isBookmarked: false,
        hasStoredMatches: true,
        leadPriority: lead.leadPriority
      };
    }

    setCurrentSavedMap(null);
    setMapSelectionSource("leads");
    onViewStateChange((current) => ({ ...current, onlyCancelled: false }));
    setSelectedMapRows(nextRows);
    void geocodeRows(leadRowsToLoad.map((lead) => lead.customerId));
    setNotice({
      kind: "success",
      message: `${leadRowsToLoad.length} selected lead${leadRowsToLoad.length === 1 ? "" : "s"} loaded on the map.`
    });
    onLeadRowsLoaded();
  }, [leadRowsToLoad]);

  const rows = state.data?.items.map((row) => ({ ...row, ...(coordinateOverrides[row.id] ?? {}) })) ?? [];
  const selectedIds = useMemo(() => new Set(Object.keys(selectedMapRows).map(Number)), [selectedMapRows]);
  const selectedRows = Object.values(selectedMapRows).map((row) => ({ ...row, ...(coordinateOverrides[row.id] ?? {}) }));
  const customerRowsInMap = selectedRows
    .filter((row) => mapSelectionSource === "customers")
    .sort((left, right) =>
      compareValues(
        viewState.sortKey === "postcode" ? left.postcode ?? "" : left.entityName,
        viewState.sortKey === "postcode" ? right.postcode ?? "" : right.entityName,
        viewState.sortDirection
      )
    );
  const customerTableRows = viewState.onlyMapped ? customerRowsInMap : rows;
  const filteredLeadRows = selectedRows.filter((row) => {
    const query = viewState.searchText.trim().toLowerCase();
    if (query) {
      const searchable = [
        row.entityName,
        row.tradingName,
        row.customerRef,
        row.mid,
        row.tradingAddress,
        row.postcode,
        row.assignedUserName,
        row.status,
        row.regionName,
        row.customerActivityStatusName,
        row.customerValueTypeLabel
      ];
      if (!searchable.filter(Boolean).some((value) => value!.toLowerCase().includes(query))) return false;
    }

    const postcodeQuery = viewState.postcodeText?.trim().toLowerCase();
    if (postcodeQuery && !(row.postcode ?? "").toLowerCase().includes(postcodeQuery)) return false;
    if (viewState.regionId && String(row.regionId ?? "") !== viewState.regionId) return false;
    if (viewState.customerActivityStatusId && String(row.customerActivityStatusId ?? "") !== viewState.customerActivityStatusId) return false;
    if (viewState.customerValueTypeId) {
      if (viewState.customerValueTypeId === "__unassigned__" && row.customerValueTypeId) return false;
      if (viewState.customerValueTypeId !== "__unassigned__" && String(row.customerValueTypeId ?? "") !== viewState.customerValueTypeId) return false;
    }
    if (viewState.assignedUserId) {
      if (viewState.assignedUserId === "__unassigned__" && row.assignedUserId) return false;
      if (viewState.assignedUserId !== "__unassigned__" && String(row.assignedUserId ?? "") !== viewState.assignedUserId) return false;
    }
    if (viewState.addedFrom && viewState.addedFrom !== "all" && row.leadPriority !== viewState.addedFrom) return false;
    if (viewState.onlyMatched && !row.hasStoredMatches) return false;
    if (viewState.onlyCancelled && row.status?.toLowerCase() !== "cancelled") return false;
    return true;
  }).sort((left, right) =>
    compareValues(
      viewState.sortKey === "postcode" ? left.postcode ?? "" : left.entityName,
      viewState.sortKey === "postcode" ? right.postcode ?? "" : right.entityName,
      viewState.sortDirection
    )
  );
  const displayedMapRows = mapSelectionSource === "leads" ? filteredLeadRows : selectedRows;
  const mappedSelectedRows = displayedMapRows.filter((row) => typeof row.latitude === "number" && typeof row.longitude === "number");
  const totalPages = Math.max(Math.ceil((state.data?.total ?? 0) / pageSize), 1);

  useEffect(() => {
    const layer = markerLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    for (const row of mappedSelectedRows) {
      const priority = row.leadPriority ?? "medium";
      const pulsingClass = pulsingCustomerId === row.id ? " pulsing" : "";
      const marker = L.marker([row.latitude!, row.longitude!], {
        icon: L.divIcon({
          className: "customer-map-pin",
          html: `<span class="customer-map-marker priority-${priority}${pulsingClass}"><span>${escapeHtml(row.entityName.slice(0, 1).toUpperCase())}</span></span>`,
          iconSize: [30, 30],
          iconAnchor: [15, 15]
        })
      });
      marker.bindPopup(`
        <strong>${escapeHtml(row.entityName)}</strong><br/>
        ${row.tradingName ? `${escapeHtml(row.tradingName)}<br/>` : ""}
        ${row.tradingAddress ? `${escapeHtml(row.tradingAddress)}<br/>` : ""}
        ${row.postcode ? `${escapeHtml(row.postcode)}<br/>` : ""}
        <span>${escapeHtml(row.geocodeAccuracy === "approximate" ? "Approximate location" : "Mapped location")}</span>
      `);
      marker.addTo(layer);
    }
  }, [mappedSelectedRows, pulsingCustomerId]);

  function handleSort(nextKey: CustomerPageViewState["sortKey"]) {
    onViewStateChange((current) => ({
      ...current,
      sortKey: nextKey,
      sortDirection: current.sortKey === nextKey && current.sortDirection === "asc" ? "desc" : "asc"
    }));
    setPage(1);
  }

  function pulseMapPin(customerId: number) {
    if (pulseTimerRef.current) window.clearTimeout(pulseTimerRef.current);
    setPulsingCustomerId(customerId);
    pulseTimerRef.current = window.setTimeout(() => {
      setPulsingCustomerId(null);
      pulseTimerRef.current = null;
    }, 2000);
  }

  function focusMapRow(row: CustomerMapRow) {
    if (!selectedIds.has(row.id)) {
      setSelectedMapRows((current) => ({
        ...current,
        [row.id]: { ...row, ...(coordinateOverrides[row.id] ?? {}) }
      }));
      if (!(typeof row.latitude === "number" && typeof row.longitude === "number")) {
        void geocodeRows([row.id]);
      }
    }
    pulseMapPin(row.id);
  }

  function resetFilters() {
    onViewStateChange({
      searchText: "",
      postcodeText: "",
      regionId: "",
      customerActivityStatusId: "",
      customerValueTypeId: "",
      assignedUserId: "",
      onlyBookmarked: false,
      onlyMapped: false,
      onlyCancelled: mapSelectionSource === "customers",
      onlyMatched: false,
      addedFrom: "",
      addedTo: "",
      sortKey: "entityName",
      sortDirection: "asc"
    });
    setPage(1);
  }

  async function geocodeRows(customerIds: number[]) {
    const ids = customerIds.filter((id) => !mappingIds.has(id));
    if (!ids.length) return;

    setMappingIds((current) => new Set([...current, ...ids]));
    setNotice(null);
    try {
      const response = await fetchWithActor(`${apiBase}/api/customer-map/geocode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerIds: ids })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? `HTTP ${response.status}`);
      }
      const payload = await response.json() as CustomerMapGeocodeResponse;
      setCoordinateOverrides((current) => {
        const next = { ...current };
        for (const result of payload.results) {
          next[result.customerId] = {
            latitude: result.latitude,
            longitude: result.longitude,
            geocodeAccuracy: result.accuracy,
            geocodeStatus: result.status
          };
        }
        return next;
      });
      setSelectedMapRows((current) => {
        const next = { ...current };
        for (const result of payload.results) {
          const existing = next[result.customerId] ?? {
            id: result.customerId,
            addedAt: "",
            entityName: `Customer ${result.customerId}`,
            isBookmarked: false,
            hasStoredMatches: false
          };
          next[result.customerId] = {
            ...existing,
            latitude: result.latitude,
            longitude: result.longitude,
            geocodeAccuracy: result.accuracy,
            geocodeStatus: result.status
          };
        }
        return next;
      });
      const failed = payload.results.filter((result) => result.status !== "mapped");
      if (failed.length) {
        setNotice({ kind: "error", message: `${failed.length} selected customer location${failed.length === 1 ? "" : "s"} could not be mapped.` });
      }
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "Could not map selected customers." });
    } finally {
      setMappingIds((current) => {
        const next = new Set(current);
        for (const id of ids) next.delete(id);
        return next;
      });
    }
  }

  function toggleSelected(row: CustomerMapRow, checked: boolean) {
    setSelectedMapRows((current) => {
      const next = { ...current };
      if (checked) next[row.id] = { ...row, ...(coordinateOverrides[row.id] ?? {}) };
      else delete next[row.id];
      return next;
    });
    setMapSelectionSource("customers");
    setCurrentSavedMap(null);

    if (checked && !(typeof row.latitude === "number" && typeof row.longitude === "number")) {
      void geocodeRows([row.id]);
    }
  }

  function removeMappedLead(row: CustomerMapRow) {
    setSelectedMapRows((current) => {
      const next = { ...current };
      delete next[row.id];
      return next;
    });
  }

  function startNewMap() {
    setCurrentSavedMap(null);
    setSelectedMapRows({});
    setPulsingCustomerId(null);
    setNotice({ kind: "success", message: "New map started." });
  }

  function openSaveMapModal() {
    const rowsToSave = mapSelectionSource === "leads" ? filteredLeadRows : selectedRows;
    if (!rowsToSave.length) {
      setNotice({ kind: "error", message: "Select at least one row before saving the map." });
      return;
    }

    setSaveMapName(currentSavedMap?.name ?? (mapSelectionSource === "leads" ? "Lead geography map" : "Customer geography map"));
    setSaveMapModalOpen(true);
  }

  async function saveCurrentMap(event?: FormEvent) {
    event?.preventDefault();
    const rowsToSave = mapSelectionSource === "leads" ? filteredLeadRows : selectedRows;
    const customerIds = rowsToSave.map((row) => row.id);
    const name = saveMapName.trim();
    if (!customerIds.length || !name) return;

    setSavingMap(true);
    try {
      const response = await fetchWithActor(currentSavedMap ? `${apiBase}/api/customer-map/saved/${currentSavedMap.id}` : `${apiBase}/api/customer-map/saved`, {
        method: currentSavedMap ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, customerIds })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        setNotice({ kind: "error", message: payload?.error ?? `HTTP ${response.status}` });
        return;
      }

      const saved = await response.json() as SavedCustomerMapDetail;
      setCurrentSavedMap(saved);
      setSaveMapModalOpen(false);
      onSavedMapsChanged();
      setNotice({ kind: "success", message: `${saved.name} saved.` });
    } finally {
      setSavingMap(false);
    }
  }

  async function deleteCurrentMap() {
    if (!currentSavedMap) return;
    const response = await fetchWithActor(`${apiBase}/api/customer-map/saved/${currentSavedMap.id}`, { method: "DELETE" });
    if (!response.ok) {
      setNotice({ kind: "error", message: `Could not delete ${currentSavedMap.name}.` });
      return;
    }
    setNotice({ kind: "success", message: `${currentSavedMap.name} deleted.` });
    setCurrentSavedMap(null);
    onSavedMapsChanged();
  }

  function fitSelectedMarkers() {
    const map = leafletMapRef.current;
    if (!map || mappedSelectedRows.length === 0) return;
    const bounds = L.latLngBounds(mappedSelectedRows.map((row) => [row.latitude!, row.longitude!] as [number, number]));
    map.fitBounds(bounds.pad(0.15), { maxZoom: 15 });
  }

  return (
    <div className="geography-page">
      <section className="customer-list-options">
        <div className="customer-filter-row customer-filter-row-primary">
          <div className="table-search customer-search-wide">
            <label htmlFor="geography-search">Search {mapSelectionSource === "leads" ? "selected leads" : "customers"}</label>
            <input id="geography-search" type="search" value={viewState.searchText} onChange={(event) => { setPage(1); onViewStateChange((current) => ({ ...current, searchText: event.target.value })); }} placeholder="Entity, trading name, ref or MID" />
          </div>
          <div className="table-search customer-search-postcode">
            <label htmlFor="geography-postcode">Filter by postcode</label>
            <input id="geography-postcode" type="search" value={viewState.postcodeText ?? ""} onChange={(event) => { setPage(1); onViewStateChange((current) => ({ ...current, postcodeText: event.target.value })); }} placeholder="Postcode" />
          </div>
          <div className="customer-inline-filters">
            {mapSelectionSource === "customers" ? (
              <label className="header-filter"><input type="checkbox" checked={viewState.onlyBookmarked ?? false} onChange={(event) => { setPage(1); onViewStateChange((current) => ({ ...current, onlyBookmarked: event.target.checked })); }} /><span>Bookmarked only</span></label>
            ) : null}
            {mapSelectionSource === "customers" ? (
              <label className="header-filter"><input type="checkbox" checked={viewState.onlyMapped ?? false} onChange={(event) => { setPage(1); onViewStateChange((current) => ({ ...current, onlyMapped: event.target.checked })); }} /><span>Only in map</span></label>
            ) : null}
            <label className="header-filter"><input type="checkbox" checked={viewState.onlyMatched} onChange={(event) => { setPage(1); onViewStateChange((current) => ({ ...current, onlyMatched: event.target.checked })); }} /><span>Only with matches</span></label>
            <label className="header-filter"><input type="checkbox" checked={viewState.onlyCancelled} onChange={(event) => { setPage(1); onViewStateChange((current) => ({ ...current, onlyCancelled: event.target.checked })); }} /><span>Cancelled only</span></label>
            <button className="secondary-action" type="button" onClick={resetFilters}>Reset</button>
          </div>
        </div>
        <div className="customer-filter-row customer-filter-row-secondary">
          <div className="table-search table-search-compact">
            <label htmlFor="geography-region">Filter by region</label>
            <select id="geography-region" value={viewState.regionId ?? ""} onChange={(event) => { setPage(1); onViewStateChange((current) => ({ ...current, regionId: event.target.value })); }}>
              <option value="">All regions</option>
              {regions.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}
            </select>
          </div>
          <div className="table-search table-search-compact">
            <label htmlFor="geography-activity">Filter by activity</label>
            <select id="geography-activity" value={viewState.customerActivityStatusId ?? ""} onChange={(event) => { setPage(1); onViewStateChange((current) => ({ ...current, customerActivityStatusId: event.target.value })); }}>
              <option value="">All activity statuses</option>
              {customerActivityStatuses.map((status) => <option key={status.id} value={status.id}>{status.name}</option>)}
            </select>
          </div>
          <div className="table-search table-search-compact">
            <label htmlFor="geography-user">Filter by user</label>
            <select id="geography-user" value={viewState.assignedUserId ?? ""} onChange={(event) => { setPage(1); onViewStateChange((current) => ({ ...current, assignedUserId: event.target.value })); }}>
              <option value="">All users</option>
              <option value="__unassigned__">Unassigned</option>
              {users.map((user) => <option key={user.id} value={user.id}>{user.fullName}</option>)}
            </select>
          </div>
          <label className="table-filter-select" htmlFor="geography-value">
            <span>Customer value</span>
            <select id="geography-value" value={viewState.customerValueTypeId ?? ""} onChange={(event) => { setPage(1); onViewStateChange((current) => ({ ...current, customerValueTypeId: event.target.value })); }}>
              <option value="">All customer values</option>
              <option value="__unassigned__">Unassigned</option>
              {customerValueTypes.map((valueType) => <option key={valueType.id} value={valueType.id}>{`Shield ${valueType.shieldOrder}${valueType.label ? ` - ${valueType.label}` : ""}`}</option>)}
            </select>
          </label>
          <label className="table-filter-select" htmlFor="geography-priority">
            <span>Priority</span>
            <select id="geography-priority" value={viewState.addedFrom || "all"} onChange={(event) => { setPage(1); onViewStateChange((current) => ({ ...current, addedFrom: event.target.value })); }}>
              <option value="all">All priorities</option>
              {leadPriorityOrder.map((priority) => <option key={priority} value={priority}>{getLeadPriorityLabel(priority)}</option>)}
            </select>
          </label>
        </div>
      </section>

      {notice && <StatusBanner kind={notice.kind} message={notice.message} />}

      <div className={mapExpanded ? "geography-layout geography-layout-map-expanded" : "geography-layout"}>
        <section className="geography-list">
          <div className="geography-list-toolbar">
            <span>{mapSelectionSource === "leads" ? `${selectedRows.length} selected leads` : `${viewState.onlyMapped ? customerRowsInMap.length : state.data?.total ?? 0} filtered customers`}</span>
            {mapSelectionSource === "leads" ? <span>{filteredLeadRows.length} after filters</span> : null}
            <span>{mappedSelectedRows.length} mapped {mapSelectionSource === "leads" ? "leads" : "selections"}</span>
            <button className="secondary-action" type="button" disabled={mappedSelectedRows.length === 0} onClick={fitSelectedMarkers}>Fit selected</button>
            <button className="secondary-action" type="button" disabled={Object.keys(selectedMapRows).length === 0 && !currentSavedMap} onClick={startNewMap}>New map</button>
            <button className="secondary-action" type="button" disabled={(mapSelectionSource === "leads" ? filteredLeadRows.length : Object.keys(selectedMapRows).length) === 0} onClick={openSaveMapModal}>
              {currentSavedMap ? "Update map" : "Save map"}
            </button>
            {currentSavedMap ? (
              <button className="secondary-action destructive-action" type="button" onClick={() => void deleteCurrentMap()}>
                Delete map
              </button>
            ) : null}
            {mapSelectionSource === "leads" ? (
              <button
                className="secondary-action"
                type="button"
                onClick={() => {
                  setSelectedMapRows({});
                  setMapSelectionSource("customers");
                  onViewStateChange((current) => ({ ...current, onlyCancelled: true }));
                }}
              >
                Clear lead map
              </button>
            ) : null}
          </div>
          {mapSelectionSource === "leads" ? (
            <DataTable
              className="geography-table"
              state={{ data: filteredLeadRows, loading: false }}
              emptyMessage="No selected leads match the current geography filters."
              columns={[
                "Map",
                renderSortHeader("Lead", viewState.sortKey === "entityName", viewState.sortDirection, () => handleSort("entityName")),
                "User",
                "Address",
                renderSortHeader("Postcode", viewState.sortKey === "postcode", viewState.sortDirection, () => handleSort("postcode")),
                "Priority",
                "Map status"
              ]}
              renderRow={(row) => {
                const mapping = mappingIds.has(row.id);
                const mapped = typeof row.latitude === "number" && typeof row.longitude === "number";
                return (
                  <tr key={row.id} className="selected" onClick={() => focusMapRow(row)}>
                    <td><button className="icon-button" type="button" onClick={(event) => { event.stopPropagation(); removeMappedLead(row); }} title="Remove from map"><Trash2 size={15} aria-hidden /></button></td>
                    <td><strong className="stacked">{row.entityName}</strong><span>{row.tradingName ?? row.customerRef ?? row.mid ?? ""}</span></td>
                    <td>{row.assignedUserName ?? "Unassigned"}</td>
                    <td className="truncate">{row.tradingAddress ?? ""}</td>
                    <td className="mono">{row.postcode ?? ""}</td>
                    <td>{getLeadPriorityLabel(row.leadPriority ?? "medium")}</td>
                    <td>
                      {mapping ? (
                        <Loader2 className="spin" size={16} aria-label="Mapping" />
                      ) : mapped ? (
                        <span className="badge">{row.geocodeAccuracy === "approximate" ? "Approximate" : "Mapped"}</span>
                      ) : row.geocodeStatus === "not_found" ? (
                        <span className="geography-status-muted">Not found</span>
                      ) : (
                        <Globe className="geography-globe-icon" size={17} aria-label="Needs map lookup" />
                      )}
                    </td>
                  </tr>
                );
              }}
            />
          ) : (
            <>
              <DataTable
                className="geography-table"
                state={viewState.onlyMapped ? { data: customerTableRows, loading: false } : { ...state, data: customerTableRows }}
                emptyMessage={viewState.onlyMapped ? "No customers are currently on the map." : "No customers match the current geography filters."}
                columns={[
                  "Map",
                  renderSortHeader("Customer", viewState.sortKey === "entityName", viewState.sortDirection, () => handleSort("entityName")),
                  "Address",
                  renderSortHeader("Postcode", viewState.sortKey === "postcode", viewState.sortDirection, () => handleSort("postcode")),
                  "Status",
                  "Map status"
                ]}
                renderRow={(row) => {
                  const selected = selectedIds.has(row.id);
                  const mapping = mappingIds.has(row.id);
                  const mapped = typeof row.latitude === "number" && typeof row.longitude === "number";
                  return (
                    <tr key={row.id} className={selected ? "selected" : ""} onClick={() => focusMapRow(row)}>
                      <td><input type="checkbox" checked={selected} onClick={(event) => event.stopPropagation()} onChange={(event) => toggleSelected(row, event.target.checked)} aria-label={`Show ${row.entityName} on map`} /></td>
                      <td><strong className="stacked">{row.entityName}</strong><span>{row.tradingName ?? row.customerRef ?? row.mid ?? ""}</span></td>
                      <td className="truncate">{row.tradingAddress ?? ""}</td>
                      <td className="mono">{row.postcode ?? ""}</td>
                      <td>{renderCustomerStatus(row.status, "customer", false, false, undefined, 0)}</td>
                      <td>
                        {mapping ? (
                          <Loader2 className="spin" size={16} aria-label="Mapping" />
                        ) : mapped ? (
                          <span className="badge">{row.geocodeAccuracy === "approximate" ? "Approximate" : "Mapped"}</span>
                        ) : row.geocodeStatus === "not_found" ? (
                          <span className="geography-status-muted">Not found</span>
                        ) : (
                          <Globe className="geography-globe-icon" size={17} aria-label="Needs map lookup" />
                        )}
                      </td>
                    </tr>
                  );
                }}
              />
              {viewState.onlyMapped ? null : (
                <div className="geography-pagination">
                  <button className="secondary-action" type="button" disabled={page <= 1} onClick={() => setPage((current) => Math.max(current - 1, 1))}>Previous</button>
                  <span>Page {page} of {totalPages}</span>
                  <button className="secondary-action" type="button" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}>Next</button>
                  <label><span>Rows</span><select value={pageSize} onChange={(event) => { setPage(1); setPageSize(Number(event.target.value)); }}><option value={10}>10</option><option value={25}>25</option><option value={50}>50</option></select></label>
                </div>
              )}
            </>
          )}
        </section>
        <section className="geography-map-panel">
          <button className="map-expand-button" type="button" onClick={() => setMapExpanded((current) => !current)} title={mapExpanded ? "Show list" : "Expand map"}>
            {mapExpanded ? <ArrowRight size={18} aria-hidden /> : <ExternalLink size={18} aria-hidden />}
          </button>
          <div ref={mapElementRef} className="geography-map" />
        </section>
      </div>
      {saveMapModalOpen ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel" aria-modal="true" aria-labelledby="geography-save-map-title" role="dialog">
            <form onSubmit={(event) => void saveCurrentMap(event)}>
              <div className="modal-header">
                <div>
                  <p className="eyebrow">Geography</p>
                  <h3 id="geography-save-map-title">{currentSavedMap ? "Update map" : "Save map"}</h3>
                </div>
                <button className="modal-close" type="button" onClick={() => setSaveMapModalOpen(false)}>
                  <span aria-hidden>×</span>
                </button>
              </div>
              <div className="modal-body">
                <div className="table-search">
                  <label htmlFor="geography-save-map-name">Map name</label>
                  <input
                    id="geography-save-map-name"
                    type="text"
                    value={saveMapName}
                    onChange={(event) => setSaveMapName(event.target.value)}
                    autoFocus
                  />
                </div>
              </div>
              <div className="modal-actions">
                <button className="secondary-action" type="button" onClick={() => setSaveMapModalOpen(false)}>Cancel</button>
                <button className="page-action-button" type="submit" disabled={!saveMapName.trim() || savingMap}>
                  {savingMap ? "Saving..." : currentSavedMap ? "Update map" : "Save map"}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function CustomersView({
  state,
  regions,
  customerActivityStatuses,
  customerValueTypes,
  users,
  currentUser,
  currentUserId,
  viewState,
  onViewStateChange,
  onOpenProspectTest,
  onOpenLead,
  onOpenAiCompanyInsight,
  onDataChanged,
  selectedCustomerId,
  highlightedCustomerId,
  onHighlightedCustomerIdChange,
  onSelectedCustomerIdChange,
  duplicateMode = false,
  allowListOptionsToggle = true
}: {
  state: LoadState<Customer[]>;
  regions: Region[];
  customerActivityStatuses: CustomerActivityStatusOption[];
  customerValueTypes: CustomerValueType[];
  users: User[];
  currentUser: User | null;
  currentUserId: string;
  viewState: CustomerPageViewState;
  onViewStateChange: Dispatch<SetStateAction<CustomerPageViewState>>;
  onOpenProspectTest: (
    customer: Customer,
    filterField: ProspectTestCustomerContext["filterField"],
    filterValue?: string | null
  ) => void;
  onOpenLead: (leadId: number) => void;
  onOpenAiCompanyInsight: (customer: Pick<Customer, "id" | "entityName" | "tradingName" | "postcode" | "hasAiInsightJobScheduled">) => void;
  onDataChanged: () => void;
  selectedCustomerId: number | null;
  highlightedCustomerId: number | null;
  onHighlightedCustomerIdChange: Dispatch<SetStateAction<number | null>>;
  onSelectedCustomerIdChange: Dispatch<SetStateAction<number | null>>;
  duplicateMode?: boolean;
  allowListOptionsToggle?: boolean;
}) {
  const [matchState, setMatchState] = useState<LoadState<CustomerMatchResult>>({ loading: false });
  const [matchedCustomerIds, setMatchedCustomerIds] = useState<Set<number>>(() => new Set());
  const [assignedUserOverrides, setAssignedUserOverrides] = useState<Record<number, Pick<Customer, "assignedUserId" | "assignedUserName">>>({});
  const [bookmarkOverrides, setBookmarkOverrides] = useState<Record<number, boolean>>({});
  const [customerHasNotesOverrides, setCustomerHasNotesOverrides] = useState<Record<number, boolean>>({});
  const [customerValueTypeOverrides, setCustomerValueTypeOverrides] = useState<Record<number, Pick<Customer, "customerValueTypeId" | "customerValueTypeLabel" | "customerValueTypeDecimalValue" | "customerValueTypeShieldOrder" | "customerValueTypeImageFileName">>>({});
  const [customerAiJobScheduledOverrides, setCustomerAiJobScheduledOverrides] = useState<Record<number, boolean>>({});
  const [customerNotesRefreshKeys, setCustomerNotesRefreshKeys] = useState<Record<number, number>>({});
  const [notice, setNotice] = useState<ArchiveNotice | null>(null);
  const [savingRegionCustomerId, setSavingRegionCustomerId] = useState<number | null>(null);
  const [savingCustomerActivityStatusId, setSavingCustomerActivityStatusId] = useState<number | null>(null);
  const [savingAssignedUserCustomerId, setSavingAssignedUserCustomerId] = useState<number | null>(null);
  const [openActionCustomerId, setOpenActionCustomerId] = useState<number | null>(null);
  const [customerContextMenuState, setCustomerContextMenuState] = useState<CustomerRowContextMenuState | null>(null);
  const [noteModalState, setNoteModalState] = useState<CustomerNoteModalState>({
    open: false,
    notesState: { loading: false },
    noteText: "",
    notedAt: "",
    saving: false
  });
  const [ownedChecklistModalState, setOwnedChecklistModalState] = useState<OwnedChecklistModalState>({
    open: false,
    matchesState: { loading: false }
  });
  const [listOptionsHidden, setListOptionsHidden] = useState(false);
  const [duplicateRefreshKey, setDuplicateRefreshKey] = useState(0);
  const [activeDuplicateReasonKey, setActiveDuplicateReasonKey] = useState<string | null>(null);
  const [hiddenDuplicateCustomerIds, setHiddenDuplicateCustomerIds] = useState<Set<number>>(() => new Set());
  const [duplicateReviewMarks, setDuplicateReviewMarks] = useState<Record<number, "not_duplicate" | "archive_duplicate" | undefined>>({});
  const [showArchiveMarkedOnly, setShowArchiveMarkedOnly] = useState(false);
  const [archivingDuplicateRows, setArchivingDuplicateRows] = useState(false);
  const customerListScrollRef = useRef<HTMLDivElement | null>(null);
  const duplicateReasonScrollTopRef = useRef(0);
  const duplicateReasonAnchorRowIdRef = useRef<number | null>(null);
  const restoreDuplicateReasonScrollRef = useRef(false);

  useEffect(() => {
    if (!state.data?.length) {
      setAssignedUserOverrides({});
      return;
    }

    const validIds = new Set(state.data.map((customer) => customer.id));
    setAssignedUserOverrides((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(([key]) => validIds.has(Number(key)))
      );
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
    setBookmarkOverrides((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(([key]) => validIds.has(Number(key)))
      );
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
    setCustomerHasNotesOverrides((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(([key]) => validIds.has(Number(key)))
      );
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
    setCustomerValueTypeOverrides((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(([key]) => validIds.has(Number(key)))
      );
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
    setCustomerAiJobScheduledOverrides((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(([key]) => validIds.has(Number(key)))
      );
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
  }, [state.data]);

  useEffect(() => {
    setBookmarkOverrides({});
  }, [currentUserId]);

  async function showMatches(customer: Customer) {
    onSelectedCustomerIdChange(customer.id);
    setMatchState({ loading: true });

    try {
      const response = await fetchWithActor(`${apiBase}/api/customers/${customer.id}/matches`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as CustomerMatchResult;
      setMatchState({ data, loading: false });
      if (data.matches.length > 0) {
        setMatchedCustomerIds((current) => new Set(current).add(customer.id));
      }
    } catch (error) {
      setMatchState({
        error: error instanceof Error ? error.message : "Could not load customer matches.",
        loading: false
      });
    }
  }

  async function loadMatches(customer: Customer) {
    onHighlightedCustomerIdChange(null);
    if (selectedCustomerId === customer.id && !matchState.loading) {
      onSelectedCustomerIdChange(null);
      setMatchState({ loading: false });
      return;
    }
    await showMatches(customer);
  }

  useEffect(() => {
    if (!selectedCustomerId || !state.data?.length) {
      return;
    }

    if (matchState.loading) {
      return;
    }

    if (matchState.data?.customerId === selectedCustomerId) {
      return;
    }

    const customer = state.data.find((row) => row.id === selectedCustomerId);
    if (!customer) {
      return;
    }

    void showMatches(customer);
  }, [selectedCustomerId, state.data]);

  useEffect(() => {
    if (!selectedCustomerId) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      const row = document.querySelector(`[data-customer-row-id="${selectedCustomerId}"]`) as HTMLElement | null;
      row?.scrollIntoView({ block: "center", behavior: "auto" });
    });

    return () => cancelAnimationFrame(frame);
  }, [selectedCustomerId, matchState.loading]);

  async function updateCustomerRegion(customer: Customer, regionId: string) {
    setSavingRegionCustomerId(customer.id);
    setNotice(null);

    try {
      const response = await fetchWithActor(`${apiBase}/api/customers/region-assignments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignments: [
            {
              customerId: customer.id,
              regionId: regionId ? Number(regionId) : null
            }
          ]
        })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? `HTTP ${response.status}`);
      }

      onDataChanged();
      const selectedRegion = regions.find((region) => String(region.id) === regionId);
      setNotice({
        kind: "success",
        message: regionId
          ? `${customer.customerRef ?? customer.entityName} moved to ${selectedRegion?.name ?? "the selected region"}.`
          : `${customer.customerRef ?? customer.entityName} region cleared.`
      });
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not update customer region."
      });
    } finally {
      setSavingRegionCustomerId(null);
    }
  }

  async function updateCustomerActivityStatus(customer: Customer, customerActivityStatusId: string) {
    setSavingCustomerActivityStatusId(customer.id);
    setNotice(null);

    try {
      const response = await fetchWithActor(`${apiBase}/api/customers/${customer.id}/activity-status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerActivityStatusId: customerActivityStatusId ? Number(customerActivityStatusId) : null })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? `HTTP ${response.status}`);
      }

      onDataChanged();
      const selectedStatus = customerActivityStatuses.find((status) => String(status.id) === customerActivityStatusId);
      setNotice({
        kind: "success",
        message: customerActivityStatusId
          ? `${customer.customerRef ?? customer.entityName} activity set to ${selectedStatus?.name ?? "the selected status"}.`
          : `${customer.customerRef ?? customer.entityName} activity status cleared.`
      });
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not update customer activity status."
      });
    } finally {
      setSavingCustomerActivityStatusId(null);
    }
  }

  async function updateCustomerAssignedUser(customer: Customer, assignedUserId: string) {
    setSavingAssignedUserCustomerId(customer.id);
    setNotice(null);

    try {
      const response = await fetchWithActor(`${apiBase}/api/customers/${customer.id}/assigned-user`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignedUserId: assignedUserId ? Number(assignedUserId) : null })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? `HTTP ${response.status}`);
      }

      const payload = (await response.json()) as {
        assignedUserId?: number | null;
        assignedUserName?: string | null;
      };
      setAssignedUserOverrides((current) => ({
        ...current,
        [customer.id]: {
          assignedUserId: payload.assignedUserId ?? undefined,
          assignedUserName: payload.assignedUserName ?? undefined
        }
      }));
      const assignedUser = users.find((user) => user.id === payload.assignedUserId);
      setNotice({
        kind: "success",
        message: payload.assignedUserId
          ? `${customer.customerRef ?? customer.entityName} assigned to ${assignedUser?.fullName ?? "the selected user"}.`
          : `${customer.customerRef ?? customer.entityName} unassigned.`
      });
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not update customer assignment."
      });
    } finally {
      setSavingAssignedUserCustomerId(null);
      setOpenActionCustomerId(null);
    }
  }

  async function scheduleCustomerAiInsight(customer: Customer) {
    setNotice(null);

    try {
      const response = await fetchWithActor(`${apiBase}/api/jobs/ai-company-insight`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          searchName: (customer.tradingName || customer.entityName).trim(),
          searchLocation: customer.postcode || null,
          customerId: customer.id,
          saveToDatabase: true
        })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? `HTTP ${response.status}`);
      }

      setCustomerAiJobScheduledOverrides((current) => ({ ...current, [customer.id]: true }));
      setNotice({
        kind: "success",
        message: `Scheduled AI Insight for ${customer.entityName}.`
      });
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not schedule AI Insight."
      });
    }
  }

  async function assignCustomerToCurrentUser(customer: Customer) {
    if (!currentUser) {
      setNotice({ kind: "error", message: "Current user is unknown." });
      return;
    }

    await updateCustomerAssignedUser(customer, String(currentUser.id));
  }

  async function archiveCustomer(customer: Customer) {
    setNotice(null);
    try {
      const response = await fetchWithActor(`${apiBase}/api/customers/${customer.id}/archive`, { method: "POST" });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? `HTTP ${response.status}`);
      }
      onDataChanged();
      setNotice({ kind: "success", message: `${customer.customerRef ?? customer.entityName} archived.` });
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not archive customer."
      });
    } finally {
      setOpenActionCustomerId(null);
    }
  }

  async function toggleCustomerBookmark(customer: Customer) {
    setNotice(null);
    try {
      const response = await fetchWithActor(`${apiBase}/api/customers/${customer.id}/bookmark`, {
        method: customer.isBookmarked ? "DELETE" : "POST"
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? `HTTP ${response.status}`);
      }
      setBookmarkOverrides((current) => ({
        ...current,
        [customer.id]: !customer.isBookmarked
      }));
      setNotice({
        kind: "success",
        message: customer.isBookmarked
          ? `${customer.customerRef ?? customer.entityName} bookmark removed.`
          : `${customer.customerRef ?? customer.entityName} bookmarked.`
      });
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not update customer bookmark."
      });
    } finally {
      setOpenActionCustomerId(null);
    }
  }

  async function clearCustomerBookmarks() {
    setNotice(null);
    try {
      const response = await fetchWithActor(`${apiBase}/api/customers/bookmarks`, {
        method: "DELETE"
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? `HTTP ${response.status}`);
      }
      setBookmarkOverrides(() =>
        Object.fromEntries((state.data ?? []).map((customer) => [customer.id, false]))
      );
      setNotice({ kind: "success", message: "Bookmarks cleared." });
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not clear bookmarks."
      });
    } finally {
      setOpenActionCustomerId(null);
    }
  }

  async function copyCustomerRowValue(value: string | null | undefined, label: string) {
    try {
      const copied = await copyTextToClipboard(value);
      if (!copied) {
        throw new Error(`No ${label.toLowerCase()} available.`);
      }
      setNotice({ kind: "success", message: `${label} copied.` });
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : `Could not copy ${label.toLowerCase()}.`
      });
    }
  }

  async function openCustomerNotes(customer: Customer) {
    setOpenActionCustomerId(null);
    setNoteModalState({
      open: true,
      customer,
      notesState: { loading: true },
      noteText: "",
      notedAt: new Date().toISOString().slice(0, 16),
      saving: false
    });

    try {
      const response = await fetchWithActor(`${apiBase}/api/customers/${customer.id}/notes`);
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? `HTTP ${response.status}`);
      }
      const notes = (await response.json()) as CustomerNote[];
      setNoteModalState((current) => ({
        ...current,
        notesState: { data: notes, loading: false }
      }));
    } catch (error) {
      setNoteModalState((current) => ({
        ...current,
        notesState: {
          error: error instanceof Error ? error.message : "Could not load customer notes.",
          loading: false
        }
      }));
    }
  }

  async function saveCustomerNote() {
    if (!noteModalState.customer) return;
    const customer = noteModalState.customer;
    setNoteModalState((current) => ({ ...current, saving: true }));

    try {
      const response = await fetchWithActor(`${apiBase}/api/customers/${customer.id}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          noteText: noteModalState.noteText,
          createdAt: noteModalState.notedAt || null
        })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? `HTTP ${response.status}`);
      }
      const notes = (await response.json()) as CustomerNote[];
      setNoteModalState((current) => ({
        ...current,
        notesState: { data: notes, loading: false },
        noteText: "",
        notedAt: new Date().toISOString().slice(0, 16),
        saving: false
      }));
      setCustomerHasNotesOverrides((current) => ({ ...current, [customer.id]: notes.length > 0 }));
      setCustomerNotesRefreshKeys((current) => ({
        ...current,
        [customer.id]: (current[customer.id] ?? 0) + 1
      }));
      setNotice({ kind: "success", message: `Note added to ${customer.customerRef ?? customer.entityName}.` });
    } catch (error) {
      setNoteModalState((current) => ({
        ...current,
        saving: false,
        notesState: current.notesState,
      }));
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not add customer note."
      });
    }
  }

  async function openCustomerOwnedChecklist(customer: Customer) {
    setOwnedChecklistModalState({
      open: true,
      customer,
      matchesState: { loading: true }
    });

    try {
      const response = await fetchWithActor(`${apiBase}/api/customers/${customer.id}/owned-checklist`);
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? `HTTP ${response.status}`);
      }
      const matches = (await response.json()) as OwnedChecklistMatch[];
      setOwnedChecklistModalState((current) => ({
        ...current,
        matchesState: { data: matches, loading: false }
      }));
    } catch (error) {
      setOwnedChecklistModalState((current) => ({
        ...current,
        matchesState: {
          error: error instanceof Error ? error.message : "Could not load ownership signals.",
          loading: false
        }
      }));
    }
  }

  function handleSort(nextKey: CustomerPageSortKey) {
    if (viewState.sortKey === nextKey) {
      onViewStateChange((current) => ({
        ...current,
        sortDirection: current.sortDirection === "asc" ? "desc" : "asc"
      }));
      return;
    }

    onViewStateChange((current) => ({
      ...current,
      sortKey: nextKey,
      sortDirection: "asc"
    }));
  }

  const customerRows = state.data?.map((row) => ({
    ...row,
    ...(assignedUserOverrides[row.id] ?? {}),
    ...(customerValueTypeOverrides[row.id] ?? {}),
    hasAiInsightJobScheduled: customerAiJobScheduledOverrides[row.id] ?? row.hasAiInsightJobScheduled,
    isBookmarked: bookmarkOverrides[row.id] ?? row.isBookmarked,
    hasNotes: customerHasNotesOverrides[row.id] ?? row.hasNotes
  }));

  const baseFilteredData = customerRows
    ?.filter((row) => {
      if (viewState.onlyCancelled && row.status !== "cancelled") {
        return false;
      }

      if (viewState.onlyMatched && !(row.hasStoredMatches || matchedCustomerIds.has(row.id))) {
        return false;
      }

      const postcodeQuery = viewState.postcodeText?.trim().toLowerCase() ?? "";
      if (postcodeQuery && !(row.postcode ?? "").toLowerCase().includes(postcodeQuery)) {
        return false;
      }

      if (viewState.regionId && String(row.regionId ?? "") !== viewState.regionId) {
        return false;
      }

      if (viewState.customerActivityStatusId && String(row.customerActivityStatusId ?? "") !== viewState.customerActivityStatusId) {
        return false;
      }

      if (viewState.customerValueTypeId) {
        if (viewState.customerValueTypeId === "__unassigned__") {
          if (row.customerValueTypeId) {
            return false;
          }
        } else if (String(row.customerValueTypeId ?? "") !== viewState.customerValueTypeId) {
          return false;
        }
      }

      if (viewState.assignedUserId) {
        if (viewState.assignedUserId === "__unassigned__") {
          if (row.assignedUserId) {
            return false;
          }
        } else if (String(row.assignedUserId ?? "") !== viewState.assignedUserId) {
          return false;
        }
      }

      if (viewState.onlyBookmarked && !row.isBookmarked) {
        return false;
      }

      if (!viewState.searchText.trim()) {
        return true;
      }

      const query = viewState.searchText.trim().toLowerCase();
      return row.entityName.toLowerCase().includes(query) || (row.tradingName ?? "").toLowerCase().includes(query);
    });

  const dedupeReviewData = baseFilteredData?.filter((row) => !hiddenDuplicateCustomerIds.has(row.id));

  const duplicateCustomerInfo = useMemo(() => {
    if (!dedupeReviewData?.length) {
      return new Map<number, DuplicateReason[]>();
    }

    const duplicateInfo = new Map<number, DuplicateReason[]>();
    const groups = new Map<string, { label: string; value: string; ids: number[] }>();

    const addGroupValue = (prefix: string, label: string, rawValue: string | null | undefined, customerId: number) => {
      const value = normalizeMatchText(rawValue);
      if (!value) {
        return;
      }

      const key = `${prefix}:${value}`;
      const displayValue = rawValue?.trim() || value;
      const current = groups.get(key);
      if (current) {
        current.ids.push(customerId);
      } else {
        groups.set(key, { label, value: displayValue, ids: [customerId] });
      }
    };

    for (const row of dedupeReviewData) {
      addGroupValue("entity", "Entity", row.entityName, row.id);
      addGroupValue("trading", "Trading", row.tradingName, row.id);
      addGroupValue("postcode", "Postcode", row.postcode, row.id);
    }

    for (const { label, value, ids } of groups.values()) {
      if (ids.length < 2) {
        continue;
      }

      const reason = { key: `${label}:${normalizeMatchText(value)}`, label, value, count: ids.length, text: `${label}: ${value} (${ids.length})` };
      for (const customerId of ids) {
        const reasons = duplicateInfo.get(customerId);
        if (reasons) {
          reasons.push(reason);
        } else {
          duplicateInfo.set(customerId, [reason]);
        }
      }
    }

    return duplicateInfo;
  }, [dedupeReviewData, duplicateRefreshKey]);

  const filteredData = dedupeReviewData
    ?.filter((row) => !duplicateMode || duplicateCustomerInfo.has(row.id))
    .filter((row) => !duplicateMode || !activeDuplicateReasonKey || duplicateCustomerInfo.get(row.id)?.some((reason) => reason.key === activeDuplicateReasonKey))
    .filter((row) => !duplicateMode || !showArchiveMarkedOnly || duplicateReviewMarks[row.id] === "archive_duplicate")
    .sort((left, right) =>
      compareValues(getCustomerSortValue(left, viewState.sortKey), getCustomerSortValue(right, viewState.sortKey), viewState.sortDirection)
    );

  const duplicateCount = duplicateCustomerInfo.size;
  const markedDuplicateCount = Object.values(duplicateReviewMarks).filter(Boolean).length;
  const archiveMarkedDuplicateIds = Object.entries(duplicateReviewMarks)
    .filter(([, mark]) => mark === "archive_duplicate")
    .map(([customerId]) => Number(customerId));
  const archiveMarkedDuplicateCount = archiveMarkedDuplicateIds.length;
  const activeDuplicateReason = activeDuplicateReasonKey
    ? Array.from(duplicateCustomerInfo.values()).flat().find((reason) => reason.key === activeDuplicateReasonKey)
    : null;
  const showListOptions = !listOptionsHidden || duplicateMode;

  function markDuplicateReview(customerId: number, mark: "not_duplicate" | "archive_duplicate", checked: boolean) {
    setDuplicateReviewMarks((current) => ({
      ...current,
      [customerId]: checked ? mark : undefined
    }));
  }

  function applyDuplicateReasonFilter(reasonKey: string, anchorCustomerId: number) {
    duplicateReasonScrollTopRef.current = customerListScrollRef.current?.scrollTop ?? 0;
    duplicateReasonAnchorRowIdRef.current = anchorCustomerId;
    restoreDuplicateReasonScrollRef.current = false;
    setActiveDuplicateReasonKey(reasonKey);
  }

  function clearDuplicateReasonFilter() {
    restoreDuplicateReasonScrollRef.current = true;
    setActiveDuplicateReasonKey(null);
  }

  function resetCustomerListView() {
    onViewStateChange({
      searchText: "",
      postcodeText: "",
      regionId: "",
      customerActivityStatusId: "",
      customerValueTypeId: "",
      assignedUserId: "",
      onlyBookmarked: false,
      onlyCancelled: duplicateMode ? false : true,
      onlyMatched: false,
      sortKey: duplicateMode ? "entityName" : "addedAt",
      sortDirection: duplicateMode ? "asc" : "desc"
    });

    if (duplicateMode) {
      setActiveDuplicateReasonKey(null);
      setHiddenDuplicateCustomerIds(new Set());
      setDuplicateReviewMarks({});
      setShowArchiveMarkedOnly(false);
      duplicateReasonAnchorRowIdRef.current = null;
      restoreDuplicateReasonScrollRef.current = false;
      setDuplicateRefreshKey((current) => current + 1);
    }
  }

  function removeMarkedDuplicateRows() {
    const markedIds = Object.entries(duplicateReviewMarks)
      .filter(([, mark]) => Boolean(mark))
      .map(([customerId]) => Number(customerId));

    if (!markedIds.length) {
      return;
    }

    setHiddenDuplicateCustomerIds((current) => {
      const next = new Set(current);
      for (const customerId of markedIds) {
        next.add(customerId);
      }
      return next;
    });
    setDuplicateReviewMarks({});
    setShowArchiveMarkedOnly(false);
  }

  async function archiveMarkedDuplicateRows() {
    const rowsToArchive = customerRows?.filter((row) => archiveMarkedDuplicateIds.includes(row.id)) ?? [];
    if (!rowsToArchive.length || archivingDuplicateRows) {
      return;
    }

    setNotice(null);
    setArchivingDuplicateRows(true);

    let successCount = 0;
    const successIds = new Set<number>();
    const failures: string[] = [];

    for (const row of rowsToArchive) {
      try {
        const response = await fetchWithActor(`${apiBase}/api/customers/${row.id}/archive`, { method: "POST" });
        if (!response.ok) {
          const payload = await response.json().catch(() => null) as { error?: string } | null;
          throw new Error(payload?.error ?? `HTTP ${response.status}`);
        }
        successCount += 1;
        successIds.add(row.id);
      } catch (error) {
        failures.push(`${row.customerRef ?? row.entityName}: ${error instanceof Error ? error.message : "Archive failed."}`);
      }
    }

    if (successCount > 0) {
      setHiddenDuplicateCustomerIds((current) => {
        const next = new Set(current);
        for (const customerId of successIds) {
          next.add(customerId);
        }
        return next;
      });
      setDuplicateReviewMarks((current) => {
        const next = { ...current };
        for (const customerId of successIds) {
          delete next[customerId];
        }
        return next;
      });
      onDataChanged();
    }

    setNotice({
      kind: failures.length ? "error" : "success",
      message: failures.length
        ? `Archived ${successCount}. Failed ${failures.length}: ${failures.slice(0, 2).join(" ")}`
        : `${successCount} duplicate customer record${successCount === 1 ? "" : "s"} archived.`
    });
    setArchivingDuplicateRows(false);
  }

  useEffect(() => {
    if (!duplicateMode || activeDuplicateReasonKey || !restoreDuplicateReasonScrollRef.current) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const anchorRowId = duplicateReasonAnchorRowIdRef.current;
        const anchorRow = anchorRowId
          ? document.querySelector(`[data-customer-row-id="${anchorRowId}"]`) as HTMLElement | null
          : null;
        if (anchorRow) {
          anchorRow.scrollIntoView({ block: "center", behavior: "auto" });
        } else {
          const scrollContainer = customerListScrollRef.current;
          if (scrollContainer) {
            scrollContainer.scrollTop = Math.min(duplicateReasonScrollTopRef.current, scrollContainer.scrollHeight);
          }
        }
        duplicateReasonAnchorRowIdRef.current = null;
        restoreDuplicateReasonScrollRef.current = false;
      });
    });

    return () => cancelAnimationFrame(frame);
  }, [activeDuplicateReasonKey, duplicateMode, filteredData?.length]);

  return (
    <div className={showListOptions ? "customer-page-layout" : "customer-page-layout customer-page-layout-options-hidden"}>
    {showListOptions && (
      <section className="customer-list-options">
        <div className="customer-filter-row customer-filter-row-primary">
          <div className="table-search customer-search-wide">
              <label htmlFor="customer-page-search">Search customers</label>
              <input
                id="customer-page-search"
                type="search"
                value={viewState.searchText}
                onChange={(event) => onViewStateChange((current) => ({ ...current, searchText: event.target.value }))}
                placeholder="Entity or trading name"
              />
            </div>
            <div className="table-search customer-search-postcode">
              <label htmlFor="customer-page-postcode-search">Filter by postcode</label>
              <input
                id="customer-page-postcode-search"
                type="search"
                value={viewState.postcodeText ?? ""}
                onChange={(event) => onViewStateChange((current) => ({ ...current, postcodeText: event.target.value }))}
                placeholder="Postcode"
              />
            </div>
            <div className="customer-inline-filters">
              <label className="header-filter">
                <input
                  type="checkbox"
                  checked={viewState.onlyBookmarked ?? false}
                  onChange={(event) => onViewStateChange((current) => ({ ...current, onlyBookmarked: event.target.checked }))}
                />
                <span>Bookmarked only</span>
              </label>
              <label className="header-filter">
                <input
                  type="checkbox"
                  checked={viewState.onlyMatched}
                  onChange={(event) => onViewStateChange((current) => ({ ...current, onlyMatched: event.target.checked }))}
                />
                <span>Only with matches</span>
              </label>
              <label className="header-filter">
                <input
                  type="checkbox"
                  checked={viewState.onlyCancelled}
                  onChange={(event) => onViewStateChange((current) => ({ ...current, onlyCancelled: event.target.checked }))}
                />
                <span>Cancelled only</span>
              </label>
              <button
                className="secondary-action"
                type="button"
                onClick={resetCustomerListView}
              >
                Reset
              </button>
            </div>
        </div>
        {duplicateMode ? (
          <p className="dedupe-explanation">
            Find duplicates refreshes the visible review list. Click a duplicate reason to focus on that shared entity, trading name, or
            postcode. The row marks are only for this page session and do not merge, archive, delete, or change customer records.
          </p>
        ) : null}
        <div className="customer-filter-row customer-filter-row-secondary">
            <div className="table-search table-search-compact">
              <label htmlFor="customer-page-region-filter">Filter by region</label>
              <select
                id="customer-page-region-filter"
                value={viewState.regionId ?? ""}
                onChange={(event) => onViewStateChange((current) => ({ ...current, regionId: event.target.value }))}
              >
                <option value="">All regions</option>
                {regions.map((region) => (
                  <option key={region.id} value={region.id}>
                    {region.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="table-search table-search-compact">
              <label htmlFor="customer-page-activity-filter">Filter by activity</label>
              <select
                id="customer-page-activity-filter"
                value={viewState.customerActivityStatusId ?? ""}
                onChange={(event) => onViewStateChange((current) => ({ ...current, customerActivityStatusId: event.target.value }))}
              >
                <option value="">All activity statuses</option>
                {customerActivityStatuses.map((status) => (
                  <option key={status.id} value={status.id}>
                    {status.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="table-search table-search-compact">
              <label htmlFor="customer-page-user-filter">Filter by user</label>
              <select
                id="customer-page-user-filter"
                value={viewState.assignedUserId ?? ""}
                onChange={(event) => onViewStateChange((current) => ({ ...current, assignedUserId: event.target.value }))}
              >
                <option value="">All users</option>
                <option value="__unassigned__">Unassigned</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.fullName}
                  </option>
                ))}
              </select>
            </div>
          <label className="table-filter-select" htmlFor="customer-page-value-filter">
            <span>Customer value</span>
            <select
              id="customer-page-value-filter"
              value={viewState.customerValueTypeId ?? ""}
              onChange={(event) => onViewStateChange((current) => ({ ...current, customerValueTypeId: event.target.value }))}
            >
              <option value="">All customer values</option>
              <option value="__unassigned__">Unassigned</option>
              {customerValueTypes.map((valueType) => (
                <option key={valueType.id} value={valueType.id}>
                  {`Shield ${valueType.shieldOrder}${valueType.label ? ` - ${valueType.label}` : ""}`}
                </option>
              ))}
            </select>
          </label>
          {duplicateMode ? (
            <>
              <span className="page-action-note">Duplicate candidates: {duplicateCount}</span>
              <button className="secondary-action" type="button" onClick={() => setDuplicateRefreshKey((current) => current + 1)}>
                Find duplicates
              </button>
              <button className="secondary-action" type="button" onClick={resetCustomerListView}>
                Show all duplicates
              </button>
              <button className="secondary-action" type="button" disabled={markedDuplicateCount === 0} onClick={removeMarkedDuplicateRows}>
                Remove marked rows
              </button>
              <button
                className={showArchiveMarkedOnly ? "secondary-action active-filter-action" : "secondary-action"}
                type="button"
                disabled={archiveMarkedDuplicateCount === 0}
                onClick={() => setShowArchiveMarkedOnly((current) => !current)}
              >
                {showArchiveMarkedOnly ? "Show all dedupe rows" : "Show archive marked"}
              </button>
              <button
                className="secondary-action destructive-action"
                type="button"
                disabled={archiveMarkedDuplicateCount === 0 || archivingDuplicateRows}
                onClick={() => void archiveMarkedDuplicateRows()}
              >
                {archivingDuplicateRows ? "Archiving..." : "Archive marked duplicates"}
              </button>
            </>
          ) : null}
        </div>
        {duplicateMode && (activeDuplicateReason || markedDuplicateCount > 0 || showArchiveMarkedOnly) ? (
          <div className="dedupe-review-summary">
            {activeDuplicateReason ? (
              <>
                <span>Filtering by {activeDuplicateReason.text}</span>
                <button className="inline-link-button" type="button" onClick={clearDuplicateReasonFilter}>
                  Clear reason filter
                </button>
              </>
            ) : null}
            {markedDuplicateCount > 0 ? <span>{markedDuplicateCount} row{markedDuplicateCount === 1 ? "" : "s"} marked</span> : null}
            {archiveMarkedDuplicateCount > 0 ? <span>{archiveMarkedDuplicateCount} marked for archive</span> : null}
            {showArchiveMarkedOnly ? <span>Showing archive-marked rows only</span> : null}
          </div>
        ) : null}
      </section>
    )}
    {notice && <StatusBanner kind={notice.kind} message={notice.message} />}
    <div ref={customerListScrollRef} className={showListOptions ? "customer-list-scroll" : "customer-list-scroll customer-list-scroll-expanded"}>
      <DataTable
        className="customers-page-table"
        state={customerRows ? { ...state, data: filteredData } : state}
        emptyMessage={duplicateMode ? "No duplicate customers found for the current rules." : "No hardened customers have been saved yet."}
        columns={[
        "Action",
        ...(duplicateMode ? ["Not duplicate", "Archive duplicate", "Duplicate reason"] : []),
        renderSortHeader("Added", viewState.sortKey === "addedAt", viewState.sortDirection, () => handleSort("addedAt")),
        renderSortHeader("Entity", viewState.sortKey === "entityName", viewState.sortDirection, () => handleSort("entityName")),
        renderSortHeader("Trading name", viewState.sortKey === "tradingName", viewState.sortDirection, () => handleSort("tradingName")),
        "Activity",
        "User",
        "Region",
        renderSortHeader("Postcode", viewState.sortKey === "postcode", viewState.sortDirection, () => handleSort("postcode")),
        <label className="header-filter" key="customer-status-filter">
          <input
            type="checkbox"
            checked={viewState.onlyCancelled}
            onChange={(event) => onViewStateChange((current) => ({ ...current, onlyCancelled: event.target.checked }))}
          />
          <span>Status</span>
        </label>
      ]}
        renderRow={(row) => {
        const bookmarkDot = getCustomerBookmarkDotState(row, currentUser);
        const duplicateReasons = duplicateCustomerInfo.get(row.id) ?? [];
        const duplicateReviewMark = duplicateReviewMarks[row.id];
        return (
        <Fragment key={row.id}>
          <tr
            className={getCustomerRowClassName(row.id === selectedCustomerId, row.id === highlightedCustomerId, row.hasLead, duplicateMode)}
            data-customer-row-id={row.id}
            onContextMenu={(event) => {
              event.preventDefault();
              setCustomerContextMenuState({
                customer: row,
                x: Math.min(event.clientX, window.innerWidth - 260),
                y: Math.min(event.clientY, window.innerHeight - 72)
              });
            }}
          >
            <td>
              <CustomerSplitActionButton
                customer={row}
                users={users}
                bookmarkDotColor={bookmarkDot.color}
                showBookmarkDot={bookmarkDot.show}
                savingAssignedUserCustomerId={savingAssignedUserCustomerId}
                openActionCustomerId={openActionCustomerId}
                onToggleOpenActionCustomerId={setOpenActionCustomerId}
                onPrimaryAction={() => void loadMatches(row)}
                onAssignUser={updateCustomerAssignedUser}
                onOpenNotes={openCustomerNotes}
                onScheduleAiInsight={scheduleCustomerAiInsight}
                onFilterCustomersByEntity={(customer) =>
                  onViewStateChange((current) => ({
                    ...current,
                    searchText: customer.entityName
                  }))
                }
                onFilterCustomersByTradingName={(customer) =>
                  onViewStateChange((current) => ({
                    ...current,
                    searchText: customer.tradingName ?? current.searchText
                  }))
                }
                onToggleBookmark={toggleCustomerBookmark}
                onClearBookmarks={clearCustomerBookmarks}
                onArchive={archiveCustomer}
                primaryLabel="Show"
              />
            </td>
            {duplicateMode ? (
              <>
              <td>
                <label className="dedupe-row-mark">
                  <input
                    type="checkbox"
                    checked={duplicateReviewMark === "not_duplicate"}
                    onChange={(event) => markDuplicateReview(row.id, "not_duplicate", event.target.checked)}
                  />
                  <span>Not duplicate</span>
                </label>
              </td>
              <td>
                <label className="dedupe-row-mark">
                  <input
                    type="checkbox"
                    checked={duplicateReviewMark === "archive_duplicate"}
                    onChange={(event) => markDuplicateReview(row.id, "archive_duplicate", event.target.checked)}
                  />
                  <span>Archive duplicate</span>
                </label>
              </td>
              <td>
                <div className="duplicate-reason-list">
                  {duplicateReasons.map((reason) => (
                    <button
                      className={reason.key === activeDuplicateReasonKey ? "duplicate-reason-badge active" : "duplicate-reason-badge"}
                      key={reason.key}
                      type="button"
                      onClick={() => applyDuplicateReasonFilter(reason.key, row.id)}
                    >
                      {reason.text}
                    </button>
                  ))}
                </div>
              </td>
              </>
            ) : null}
            <td>{formatDateTime(row.addedAt)}</td>
            <td>
              <button className="row-link" type="button" onClick={() => onOpenProspectTest(row, "entityName", row.entityName)}>
                {row.entityName}
              </button>
            </td>
            <td>
              {row.tradingName ? (
                <button className="row-link" type="button" onClick={() => onOpenProspectTest(row, "tradingName", row.tradingName)}>
                  {row.tradingName}
                </button>
              ) : (
                ""
              )}
            </td>
            <td>
              <select
                className="header-select"
                value={row.customerActivityStatusId ? String(row.customerActivityStatusId) : ""}
                disabled={savingCustomerActivityStatusId === row.id}
                onChange={(event) => void updateCustomerActivityStatus(row, event.target.value)}
              >
                <option value="">No activity status</option>
                {customerActivityStatuses.map((status) => (
                  <option key={status.id} value={status.id}>
                    {status.name}
                  </option>
                ))}
              </select>
            </td>
            <td>{row.assignedUserName ?? ""}</td>
            <td>
              <select
                className="header-select"
                value={row.regionId ? String(row.regionId) : ""}
                disabled={savingRegionCustomerId === row.id}
                onChange={(event) => void updateCustomerRegion(row, event.target.value)}
              >
                <option value="">No region</option>
                {regions.map((region) => (
                  <option key={region.id} value={region.id}>
                    {region.name}
                  </option>
                ))}
              </select>
            </td>
            <td className="mono">
              {row.postcode ? (
                <button className="row-link" type="button" onClick={() => onOpenProspectTest(row, "postcode", row.postcode)}>
                  {row.postcode}
                </button>
              ) : (
                ""
              )}
            </td>
            <td>{renderCustomerStatus(row.status, row.customerKind, row.hasNotes, row.hasOwnedChecklistMatch, row.customerValueTypeImageFileName, row.attachedProspectCount, () => void openCustomerNotes(row), () => void openCustomerOwnedChecklist(row))}</td>
          </tr>
          {row.id === selectedCustomerId && (
            <CustomerMatchDetailRow
              colspan={duplicateMode ? 12 : 9}
              state={matchState}
              customerId={row.id}
              customer={row}
              customerValueTypes={customerValueTypes}
              notesRefreshKey={customerNotesRefreshKeys[row.id] ?? 0}
              onCustomerValueChanged={(customerId, next) =>
                setCustomerValueTypeOverrides((current) => ({ ...current, [customerId]: next }))
              }
              onOpenLead={onOpenLead}
              onOpenAiCompanyInsight={onOpenAiCompanyInsight}
              onDataChanged={onDataChanged}
              onMatchesChanged={(next) => setMatchState({ data: next, loading: false })}
            />
          )}
        </Fragment>
        );
      }}
      />
    </div>
    <CustomerNotesModal
      state={noteModalState}
      onClose={() => setNoteModalState({ open: false, notesState: { loading: false }, noteText: "", notedAt: "", saving: false })}
      onNoteTextChange={(value) => setNoteModalState((current) => ({ ...current, noteText: value }))}
      onNotedAtChange={(value) => setNoteModalState((current) => ({ ...current, notedAt: value }))}
      onSave={() => void saveCustomerNote()}
    />
      <OwnedChecklistModal
        state={ownedChecklistModalState}
        onClose={() => setOwnedChecklistModalState({ open: false, matchesState: { loading: false } })}
      />
      <CustomerRowContextMenu
        state={customerContextMenuState}
        onClose={() => setCustomerContextMenuState(null)}
        onToggleBookmark={toggleCustomerBookmark}
        canAssignToCurrentUser={Boolean(currentUser)}
        onAssignToCurrentUser={assignCustomerToCurrentUser}
        onCopyEntityName={(customer) => copyCustomerRowValue(customer.entityName, "Entity name")}
        onCopyTradingName={(customer) => copyCustomerRowValue(customer.tradingName, "Trading name")}
        onCopyPostcode={(customer) => copyCustomerRowValue(customer.postcode, "Postcode")}
        showListOptionsToggle={allowListOptionsToggle}
        listOptionsHidden={listOptionsHidden}
        onToggleListOptions={() => setListOptionsHidden((current) => !current)}
      />
    </div>
  );
}

function CustomerNotesModal({
  state,
  onClose,
  onNoteTextChange,
  onNotedAtChange,
  onSave
}: {
  state: CustomerNoteModalState;
  onClose: () => void;
  onNoteTextChange: (value: string) => void;
  onNotedAtChange: (value: string) => void;
  onSave: () => void;
}) {
  if (!state.open) return null;

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-panel" aria-modal="true" aria-labelledby="customer-notes-title" role="dialog">
        <div className="modal-header">
          <div>
            <p className="eyebrow">Notes</p>
            <h3 id="customer-notes-title">{state.customer?.customerRef ?? state.customer?.entityName ?? "Customer"}</h3>
          </div>
          <button className="modal-close" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="modal-body modal-scroll">
          {state.notesState.loading && <PanelSkeleton compact />}
          {state.notesState.error && <ErrorPanel error={state.notesState.error} />}
          {!state.notesState.loading && !state.notesState.error && (
            <div className="customer-note-list">
              {state.notesState.data?.length ? (
                state.notesState.data.map((note) => (
                  <article className="customer-note-item" key={note.id}>
                    <div className="customer-note-meta">
                      <strong>{note.createdByUserName ?? "Unknown user"}</strong>
                      <span>{formatDateTime(note.createdAt)}</span>
                    </div>
                    <p>{note.noteText}</p>
                  </article>
                ))
              ) : (
                <p>No notes yet.</p>
              )}
            </div>
          )}
          <div className="table-search">
            <label htmlFor="customer-note-datetime">Date/time</label>
            <input
              id="customer-note-datetime"
              type="datetime-local"
              value={state.notedAt}
              onChange={(event) => onNotedAtChange(event.target.value)}
            />
          </div>
          <div className="table-search">
            <label htmlFor="customer-note-text">Note</label>
            <textarea
              id="customer-note-text"
              className="customer-note-textarea"
              value={state.noteText}
              onChange={(event) => onNoteTextChange(event.target.value)}
              rows={4}
            />
          </div>
          <div className="modal-actions">
            <button className="secondary-action" type="button" onClick={onClose}>
              Cancel
            </button>
            <button className="page-action-button" type="button" disabled={state.saving || !state.noteText.trim()} onClick={onSave}>
              {state.saving ? "Saving..." : "Add Note"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function OwnedChecklistModal({
  state,
  onClose
}: {
  state: OwnedChecklistModalState;
  onClose: () => void;
}) {
  if (!state.open) return null;

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-panel" aria-modal="true" aria-labelledby="owned-checklist-title" role="dialog">
        <div className="modal-header">
          <div>
            <p className="eyebrow">Potential External Owner</p>
            <h3 id="owned-checklist-title">{state.customer?.customerRef ?? state.customer?.entityName ?? "Customer"}</h3>
          </div>
          <button className="modal-close" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="modal-body modal-scroll">
          {state.matchesState.loading && <PanelSkeleton compact />}
          {state.matchesState.error && <ErrorPanel error={state.matchesState.error} />}
          {!state.matchesState.loading && !state.matchesState.error && (
            <div className="customer-note-list">
              {state.matchesState.data?.length ? (
                state.matchesState.data.map((match) => (
                  <article className="customer-note-item" key={match.id}>
                    <div className="customer-note-meta">
                      <strong>{match.reason}</strong>
                      <span>{formatDateTime(match.createdAt)}</span>
                    </div>
                    <p><strong>Business:</strong> {match.businessName}</p>
                    <p><strong>Owner:</strong> {match.ownerName}</p>
                    {match.contactName ? <p><strong>Contact:</strong> {match.contactName}</p> : null}
                    {match.contactEmail ? <p><strong>Email:</strong> <CopyableEmail email={match.contactEmail} /></p> : null}
                    <p className="muted">Retained until {formatDateTime(match.expiresAt)}</p>
                  </article>
                ))
              ) : (
                <p>No current ownership signals found.</p>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function CustomerImportMatchesModal({
  open,
  matches,
  onClose
}: {
  open: boolean;
  matches: CustomerImportMatchResult[];
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-panel modal-panel-wide" aria-modal="true" aria-labelledby="customer-import-matches-title" role="dialog">
        <div className="modal-header">
          <div>
            <p className="eyebrow">Customer Import</p>
            <h3 id="customer-import-matches-title">Current Customer Matches</h3>
          </div>
          <button className="modal-close" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="modal-body modal-scroll">
          {!matches.length && <p>No current customer matches were found.</p>}
          {matches.map((match) => (
            <div key={match.rowKey} className="match-result-card">
              <div className="match-result-header">
                <strong>{match.row.entity}</strong>
                <span className="muted">
                  {[match.row.tradingName, match.row.tradingPostcode].filter(Boolean).join(" / ")}
                </span>
              </div>
              <div className="match-result-list">
                {match.matches.map((customer) => (
                  <div key={`${match.rowKey}-${customer.customerId}`} className="match-result-item">
                    <div>
                      <strong>{customer.entityName}</strong>
                      <div className="muted">
                        {[customer.tradingName, customer.postcode, customer.regionName].filter(Boolean).join(" / ")}
                      </div>
                      {customer.tradingAddress && <div className="muted">{customer.tradingAddress}</div>}
                    </div>
                    <div className="row-actions">
                      {customer.reasons.map((reason) => (
                        <span key={reason} className="match-chip">
                          {reason}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div className="modal-actions">
            <button className="page-action-button" type="button" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function ProspectCleanseView({
  state,
  viewState,
  onViewStateChange,
  onDataChanged
}: {
  state: LoadState<Prospect[]>;
  viewState: ProspectPageViewState;
  onViewStateChange: Dispatch<SetStateAction<ProspectPageViewState>>;
  onDataChanged: () => void;
}) {
  const [detailState, setDetailState] = useState<LoadState<ProspectDetail>>({ loading: false });
  const [selectedProspectId, setSelectedProspectId] = useState("");
  const [storedDetailIds, setStoredDetailIds] = useState<Set<string>>(() => new Set());
  const [archivingId, setArchivingId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [notice, setNotice] = useState<ArchiveNotice | null>(null);
  const [batchArchiveState, setBatchArchiveState] = useState<BatchArchiveState>({
    open: false,
    running: false,
    completed: false,
    total: 0,
    completedCount: 0,
    successCount: 0,
    failedCount: 0
  });

  async function loadProspectDetail(prospectId: string) {
    if (selectedProspectId === prospectId && detailState.data) {
      setSelectedProspectId("");
      setDetailState({ loading: false });
      return;
    }

    setSelectedProspectId(prospectId);
    setDetailState({ loading: true });

    try {
      const response = await fetchWithActor(`${apiBase}/api/test/prospect-detail/${encodeURIComponent(prospectId)}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as ProspectDetail;
      setDetailState({ data, loading: false });
      setStoredDetailIds((current) => new Set(current).add(prospectId));
    } catch (error) {
      setDetailState({
        error: error instanceof Error ? error.message : "Could not load prospect detail.",
        loading: false
      });
    }
  }

  async function archiveProspect(row: Prospect) {
    setArchivingId(row.id);
    setNotice(null);

    try {
      const response = await fetchWithActor(`${apiBase}/api/prospects/${row.id}/archive`, { method: "POST" });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? `HTTP ${response.status}`);
      }

      if (selectedProspectId === row.prospectId) {
        setSelectedProspectId("");
        setDetailState({ loading: false });
      }
      setSelectedIds((current) => {
        const next = new Set(current);
        next.delete(row.id);
        return next;
      });
      setNotice({ kind: "success", message: `${row.prospectId} archived.` });
      onDataChanged();
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not archive prospect."
      });
    } finally {
      setArchivingId(null);
    }
  }

  function handleSort(nextKey: ProspectPageSortKey) {
    if (viewState.sortKey === nextKey) {
      onViewStateChange((current) => ({
        ...current,
        sortDirection: current.sortDirection === "asc" ? "desc" : "asc"
      }));
      return;
    }

    onViewStateChange((current) => ({
      ...current,
      sortKey: nextKey,
      sortDirection: "asc"
    }));
  }

  const addedFromTime = parseDateTimeFilter(viewState.addedFrom);
  const addedToTime = parseDateTimeFilter(viewState.addedTo);

  const sortedData = state.data
    ? [...state.data]
        .filter((row) => {
          const addedTime = parseRowDateTime(row.addedAt);
          if (addedFromTime !== null && (addedTime === null || addedTime < addedFromTime)) {
            return false;
          }
          if (addedToTime !== null && (addedTime === null || addedTime > addedToTime)) {
            return false;
          }

          const query = viewState.searchText.trim().toLowerCase();
          if (!query) return true;

          const baseFields = [row.prospectId, row.businessName, row.contactName, row.contactEmail, row.postcode];
          const detailFields = viewState.searchDetails
            ? [row.channel, row.origin, row.addressLine1, row.town, row.county, row.contactPhone]
            : [];

          return [...baseFields, ...detailFields]
            .filter(Boolean)
            .some((value) => value!.toLowerCase().includes(query));
        })
        .sort((left, right) =>
          compareValues(
            getProspectPageSortValue(left, viewState.sortKey),
            getProspectPageSortValue(right, viewState.sortKey),
            viewState.sortDirection
          )
        )
    : state.data;

  const visibleRows = sortedData ?? [];
  const visibleIds = visibleRows.map((row) => row.id);
  const selectedVisibleCount = visibleIds.filter((id) => selectedIds.has(id)).length;
  const allVisibleSelected = visibleIds.length > 0 && selectedVisibleCount === visibleIds.length;

  function toggleSelectAllVisible(checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const id of visibleIds) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  function openBatchArchiveModal() {
    setBatchArchiveState({
      open: true,
      running: false,
      completed: false,
      total: selectedVisibleCount,
      completedCount: 0,
      successCount: 0,
      failedCount: 0
    });
  }

  function closeBatchArchiveModal() {
    if (batchArchiveState.running) return;
    setBatchArchiveState({
      open: false,
      running: false,
      completed: false,
      total: 0,
      completedCount: 0,
      successCount: 0,
      failedCount: 0
    });
  }

  async function runBatchArchive() {
    const targets = visibleRows.filter((row) => selectedIds.has(row.id));
    setNotice(null);
    setBatchArchiveState({
      open: true,
      running: true,
      completed: false,
      total: targets.length,
      completedCount: 0,
      successCount: 0,
      failedCount: 0
    });

    if (!targets.length) {
      setBatchArchiveState({
        open: true,
        running: false,
        completed: true,
        total: 0,
        completedCount: 0,
        successCount: 0,
        failedCount: 0
      });
      return;
    }

    let successCount = 0;
    let failedCount = 0;

    for (const row of targets) {
      setBatchArchiveState((current) => ({ ...current, currentLabel: row.prospectId }));

      try {
        const response = await fetchWithActor(`${apiBase}/api/prospects/${row.id}/archive`, { method: "POST" });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        successCount += 1;
      } catch {
        failedCount += 1;
      }

      setBatchArchiveState((current) => ({
        ...current,
        completedCount: current.completedCount + 1,
        successCount,
        failedCount
      }));
    }

    setSelectedIds((current) => {
      const next = new Set(current);
      for (const row of targets) {
        next.delete(row.id);
      }
      return next;
    });

    onDataChanged();
    setNotice({
      kind: failedCount ? "error" : "success",
      message: failedCount
        ? `Archive complete. ${successCount} archived, ${failedCount} failed.`
        : `Archive complete. ${successCount} prospect records archived.`
    });
    setBatchArchiveState((current) => ({
      ...current,
      running: false,
      completed: true,
      currentLabel: undefined
    }));
  }

  return (
    <>
      <section className="table-controls">
        <div className="table-search-group">
          <div className="table-search">
            <label htmlFor="prospect-cleanse-search">Search prospects</label>
            <input
              id="prospect-cleanse-search"
              type="search"
              value={viewState.searchText}
              onChange={(event) => onViewStateChange((current) => ({ ...current, searchText: event.target.value }))}
              placeholder={viewState.searchDetails ? "Prospect, contact, postcode, or stored detail" : "Prospect, contact, or postcode"}
            />
          </div>
          <div className="table-search">
            <label htmlFor="prospect-cleanse-added-from">Added from</label>
            <input
              id="prospect-cleanse-added-from"
              type="datetime-local"
              value={viewState.addedFrom ?? ""}
              onChange={(event) => onViewStateChange((current) => ({ ...current, addedFrom: event.target.value }))}
            />
          </div>
          <div className="table-search">
            <label htmlFor="prospect-cleanse-added-to">Added to</label>
            <input
              id="prospect-cleanse-added-to"
              type="datetime-local"
              value={viewState.addedTo ?? ""}
              onChange={(event) => onViewStateChange((current) => ({ ...current, addedTo: event.target.value }))}
            />
          </div>
        </div>
        <div className="table-filter-actions">
          <label className="header-filter">
            <input
              type="checkbox"
              checked={viewState.searchDetails}
              onChange={(event) => onViewStateChange((current) => ({ ...current, searchDetails: event.target.checked }))}
            />
            <span>Search details</span>
          </label>
          <button
            className="page-action-button"
            type="button"
            disabled={!selectedVisibleCount}
            onClick={openBatchArchiveModal}
          >
            Archive Selected
          </button>
          <button
            className="secondary-action"
            type="button"
            onClick={() =>
              onViewStateChange({
                searchText: "",
                searchDetails: false,
                addedFrom: "",
                addedTo: "",
                sortKey: "addedAt",
                sortDirection: "desc"
              })
            }
          >
            Reset
          </button>
        </div>
      </section>
      {notice && <StatusBanner kind={notice.kind} message={notice.message} />}
      <DataTable
        state={state.data ? { ...state, data: sortedData } : state}
        emptyMessage="No hardened prospects are available to cleanse."
        columns={[
          <label className="header-filter" key="prospect-cleanse-select-all">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={(event) => toggleSelectAllVisible(event.target.checked)}
            />
            <span>Select</span>
          </label>,
          "Action",
          "Prospect",
          renderSortHeader("Added", viewState.sortKey === "addedAt", viewState.sortDirection, () => handleSort("addedAt")),
          renderSortHeader("Business", viewState.sortKey === "businessName", viewState.sortDirection, () => handleSort("businessName")),
          renderSortHeader("Contact", viewState.sortKey === "contactName", viewState.sortDirection, () => handleSort("contactName")),
          "Email",
          "Owner",
          renderSortHeader("Postcode", viewState.sortKey === "postcode", viewState.sortDirection, () => handleSort("postcode")),
          "Flag"
        ]}
        renderRow={(row) => (
          <Fragment key={row.id}>
            <tr className={getLeadLinkedRowClassName(row.prospectId === selectedProspectId, row.hasLead)}>
              <td>
                <input
                  className="row-select-checkbox"
                  type="checkbox"
                  checked={selectedIds.has(row.id)}
                  onChange={(event) =>
                    setSelectedIds((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(row.id);
                      else next.delete(row.id);
                      return next;
                    })
                  }
                  aria-label={`Select ${row.prospectId}`}
                />
              </td>
              <td>
                <div className="row-actions row-actions-inline">
                  <button className="details-button" type="button" onClick={() => void loadProspectDetail(row.prospectId)}>
                    {row.hasStoredDetail || storedDetailIds.has(row.prospectId) ? "Show" : "Details"}
                  </button>
                  <button
                    className="secondary-action destructive-action"
                    type="button"
                    disabled={archivingId === row.id}
                    onClick={() => void archiveProspect(row)}
                  >
                    {archivingId === row.id ? "Archiving..." : "Archive"}
                  </button>
                </div>
              </td>
              <td className="mono">{row.prospectId}</td>
              <td>{formatDateTime(row.addedAt)}</td>
              <td>{row.businessName}</td>
              <td>{row.contactName ?? ""}</td>
              <td><CopyableEmail email={row.contactEmail} /></td>
              <td>{row.ownerName ?? ""}</td>
              <td className="mono">{row.postcode ?? ""}</td>
              <td>{row.hasPaymentsenseCustomerMatch ? <Badge text="PS match" /> : ""}</td>
            </tr>
            {row.prospectId === selectedProspectId && (
              <InlineProspectDetailRow colspan={10} detailState={detailState} />
            )}
          </Fragment>
        )}
      />
      <BatchArchiveModal
        state={batchArchiveState}
        onClose={closeBatchArchiveModal}
        onConfirm={() => void runBatchArchive()}
        scopeLabel="Prospect Cleanse"
        title="Archive selected prospect rows"
        noun="prospect row"
        actionLabel="Archive Selected"
        completionLabel="prospect rows archived"
      />
    </>
  );
}

function CustomerCleanseView({
  state,
  regions,
  viewState,
  onViewStateChange,
  onDataChanged
}: {
  state: LoadState<Customer[]>;
  regions: Region[];
  viewState: CustomerPageViewState;
  onViewStateChange: Dispatch<SetStateAction<CustomerPageViewState>>;
  onDataChanged: () => void;
}) {
  const [archivingId, setArchivingId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [notice, setNotice] = useState<ArchiveNotice | null>(null);
  const [batchArchiveState, setBatchArchiveState] = useState<BatchArchiveState>({
    open: false,
    running: false,
    completed: false,
    total: 0,
    completedCount: 0,
    successCount: 0,
    failedCount: 0
  });

  async function archiveCustomer(row: Customer) {
    setArchivingId(row.id);
    setNotice(null);

    try {
      const response = await fetchWithActor(`${apiBase}/api/customers/${row.id}/archive`, { method: "POST" });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? `HTTP ${response.status}`);
      }

      setNotice({ kind: "success", message: `${row.customerRef ?? row.mid ?? row.entityName} archived.` });
      setSelectedIds((current) => {
        const next = new Set(current);
        next.delete(row.id);
        return next;
      });
      onDataChanged();
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not archive customer."
      });
    } finally {
      setArchivingId(null);
    }
  }

  function handleSort(nextKey: CustomerPageSortKey) {
    if (viewState.sortKey === nextKey) {
      onViewStateChange((current) => ({
        ...current,
        sortDirection: current.sortDirection === "asc" ? "desc" : "asc"
      }));
      return;
    }

    onViewStateChange((current) => ({
      ...current,
      sortKey: nextKey,
      sortDirection: "asc"
    }));
  }

  const addedFromTime = parseDateTimeFilter(viewState.addedFrom);
  const addedToTime = parseDateTimeFilter(viewState.addedTo);

  const filteredData = state.data
    ?.filter((row) => {
      if (viewState.onlyCancelled && row.customerKind !== "customer") {
        return false;
      }

      const postcodeQuery = viewState.postcodeText?.trim().toLowerCase() ?? "";
      if (postcodeQuery && !(row.postcode ?? "").toLowerCase().includes(postcodeQuery)) {
        return false;
      }

      if (viewState.regionId && String(row.regionId ?? "") !== viewState.regionId) {
        return false;
      }

      const addedTime = parseRowDateTime(row.addedAt);
      if (addedFromTime !== null && (addedTime === null || addedTime < addedFromTime)) {
        return false;
      }
      if (addedToTime !== null && (addedTime === null || addedTime > addedToTime)) {
        return false;
      }

      if (!viewState.searchText.trim()) {
        return true;
      }

      const query = viewState.searchText.trim().toLowerCase();
      return row.entityName.toLowerCase().includes(query) || (row.tradingName ?? "").toLowerCase().includes(query);
    })
    .sort((left, right) =>
      compareValues(getCustomerSortValue(left, viewState.sortKey), getCustomerSortValue(right, viewState.sortKey), viewState.sortDirection)
    );

  const visibleRows = filteredData ?? [];
  const visibleIds = visibleRows.map((row) => row.id);
  const selectedVisibleCount = visibleIds.filter((id) => selectedIds.has(id)).length;
  const allVisibleSelected = visibleIds.length > 0 && selectedVisibleCount === visibleIds.length;

  function toggleSelectAllVisible(checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const id of visibleIds) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  function openBatchArchiveModal() {
    setBatchArchiveState({
      open: true,
      running: false,
      completed: false,
      total: selectedVisibleCount,
      completedCount: 0,
      successCount: 0,
      failedCount: 0
    });
  }

  function closeBatchArchiveModal() {
    if (batchArchiveState.running) return;
    setBatchArchiveState({
      open: false,
      running: false,
      completed: false,
      total: 0,
      completedCount: 0,
      successCount: 0,
      failedCount: 0
    });
  }

  async function runBatchArchive() {
    const targets = visibleRows.filter((row) => selectedIds.has(row.id));
    setNotice(null);
    setBatchArchiveState({
      open: true,
      running: true,
      completed: false,
      total: targets.length,
      completedCount: 0,
      successCount: 0,
      failedCount: 0
    });

    if (!targets.length) {
      setBatchArchiveState({
        open: true,
        running: false,
        completed: true,
        total: 0,
        completedCount: 0,
        successCount: 0,
        failedCount: 0
      });
      return;
    }

    let successCount = 0;
    let failedCount = 0;

    for (const row of targets) {
      const rowLabel = row.customerRef ?? row.mid ?? row.entityName;
      setBatchArchiveState((current) => ({ ...current, currentLabel: rowLabel }));

      try {
        const response = await fetchWithActor(`${apiBase}/api/customers/${row.id}/archive`, { method: "POST" });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        successCount += 1;
      } catch {
        failedCount += 1;
      }

      setBatchArchiveState((current) => ({
        ...current,
        completedCount: current.completedCount + 1,
        successCount,
        failedCount
      }));
    }

    setSelectedIds((current) => {
      const next = new Set(current);
      for (const row of targets) {
        next.delete(row.id);
      }
      return next;
    });

    onDataChanged();
    setNotice({
      kind: failedCount ? "error" : "success",
      message: failedCount
        ? `Cleanse complete. ${successCount} archived, ${failedCount} failed.`
        : `Cleanse complete. ${successCount} customer records archived.`
    });
    setBatchArchiveState((current) => ({
      ...current,
      running: false,
      completed: true,
      currentLabel: undefined
    }));
  }

  return (
    <>
      <section className="table-controls">
        <div className="table-search-group">
          <div className="table-search">
            <label htmlFor="customer-cleanse-search">Search customers</label>
            <input
              id="customer-cleanse-search"
              type="search"
              value={viewState.searchText}
              onChange={(event) => onViewStateChange((current) => ({ ...current, searchText: event.target.value }))}
              placeholder="Entity or trading name"
            />
          </div>
          <div className="table-search">
            <label htmlFor="customer-cleanse-postcode-search">Filter by postcode</label>
            <input
              id="customer-cleanse-postcode-search"
              type="search"
              value={viewState.postcodeText ?? ""}
              onChange={(event) => onViewStateChange((current) => ({ ...current, postcodeText: event.target.value }))}
              placeholder="Postcode"
            />
          </div>
          <div className="table-search">
            <label htmlFor="customer-cleanse-added-from">Added from</label>
            <input
              id="customer-cleanse-added-from"
              type="datetime-local"
              value={viewState.addedFrom ?? ""}
              onChange={(event) => onViewStateChange((current) => ({ ...current, addedFrom: event.target.value }))}
            />
          </div>
          <div className="table-search">
            <label htmlFor="customer-cleanse-added-to">Added to</label>
            <input
              id="customer-cleanse-added-to"
              type="datetime-local"
              value={viewState.addedTo ?? ""}
              onChange={(event) => onViewStateChange((current) => ({ ...current, addedTo: event.target.value }))}
            />
          </div>
          <div className="table-search table-search-compact">
            <label htmlFor="customer-cleanse-region-filter">Filter by region</label>
            <select
              id="customer-cleanse-region-filter"
              value={viewState.regionId ?? ""}
              onChange={(event) => onViewStateChange((current) => ({ ...current, regionId: event.target.value }))}
            >
              <option value="">All regions</option>
              {regions.map((region) => (
                <option key={region.id} value={region.id}>
                  {region.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="table-filter-actions">
          <label className="header-filter">
            <input
              type="checkbox"
              checked={viewState.onlyCancelled}
              onChange={(event) => onViewStateChange((current) => ({ ...current, onlyCancelled: event.target.checked }))}
            />
            <span>Customer only</span>
          </label>
          <button
            className="page-action-button"
            type="button"
            disabled={!selectedVisibleCount}
            onClick={openBatchArchiveModal}
          >
            Archive Selected
          </button>
          <button
            className="secondary-action"
            type="button"
            onClick={() =>
            onViewStateChange({
              searchText: "",
              postcodeText: "",
              regionId: "",
              onlyCancelled: false,
              onlyMatched: false,
              addedFrom: "",
              addedTo: "",
              sortKey: "addedAt",
              sortDirection: "desc"
              })
            }
          >
            Reset
          </button>
        </div>
      </section>
      {notice && <StatusBanner kind={notice.kind} message={notice.message} />}
      <DataTable
        state={state.data ? { ...state, data: filteredData } : state}
        emptyMessage="No hardened customers are available to cleanse."
        columns={[
          <label className="header-filter" key="customer-cleanse-select-all">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={(event) => toggleSelectAllVisible(event.target.checked)}
            />
            <span>Select</span>
          </label>,
          "Action",
          "Customer ref",
          "MID",
          renderSortHeader("Added", viewState.sortKey === "addedAt", viewState.sortDirection, () => handleSort("addedAt")),
          renderSortHeader("Entity", viewState.sortKey === "entityName", viewState.sortDirection, () => handleSort("entityName")),
          renderSortHeader("Trading name", viewState.sortKey === "tradingName", viewState.sortDirection, () => handleSort("tradingName")),
          "Region",
          renderSortHeader("Postcode", viewState.sortKey === "postcode", viewState.sortDirection, () => handleSort("postcode")),
          <label className="header-filter" key="customer-cleanse-status-filter">
            <input
              type="checkbox"
              checked={viewState.onlyCancelled}
              onChange={(event) => onViewStateChange((current) => ({ ...current, onlyCancelled: event.target.checked }))}
            />
            <span>Customer</span>
          </label>
        ]}
        renderRow={(row) => (
          <tr key={row.id} className={row.hasLead ? "lead-linked-row" : undefined}>
            <td>
              <input
                className="row-select-checkbox"
                type="checkbox"
                checked={selectedIds.has(row.id)}
                onChange={(event) =>
                  setSelectedIds((current) => {
                    const next = new Set(current);
                    if (event.target.checked) next.add(row.id);
                    else next.delete(row.id);
                    return next;
                  })
                }
                aria-label={`Select ${row.customerRef ?? row.mid ?? row.entityName}`}
              />
            </td>
            <td>
              <button
                className="secondary-action destructive-action"
                type="button"
                disabled={archivingId === row.id}
                onClick={() => void archiveCustomer(row)}
              >
                {archivingId === row.id ? "Archiving..." : "Archive"}
              </button>
            </td>
            <td className="mono">{row.customerRef ?? ""}</td>
            <td className="mono">{row.mid ?? ""}</td>
            <td>{formatDateTime(row.addedAt)}</td>
            <td>{row.entityName}</td>
            <td>{row.tradingName ?? ""}</td>
            <td>{row.regionName ?? ""}</td>
            <td className="mono">{row.postcode ?? ""}</td>
            <td>{renderCustomerStatus(row.status, row.customerKind, row.hasNotes, row.hasOwnedChecklistMatch, row.customerValueTypeImageFileName, row.attachedProspectCount)}</td>
          </tr>
        )}
      />
      <BatchArchiveModal
        state={batchArchiveState}
        onClose={closeBatchArchiveModal}
        onConfirm={() => void runBatchArchive()}
        scopeLabel="Customer Cleanse"
        title="Archive selected customer rows"
        noun="customer row"
        actionLabel="Archive Selected"
        completionLabel="customer rows archived"
      />
    </>
  );
}

function MatchesView({ state }: { state: LoadState<MatchCandidate[]> }) {
  return (
    <DataTable
      state={state}
      emptyMessage="No match candidates have been generated yet."
      columns={["Score", "Prospect", "Customer", "MID", "Reasons", "Status"]}
      renderRow={(row) => (
        <tr key={row.id}>
          <td className="score">{Math.round(Number(row.score) * 100)}%</td>
          <td>
            <span className="stacked">{row.prospectName}</span>
            <span className="muted mono">{row.prospectId}</span>
          </td>
          <td>
            <span className="stacked">{row.customerName}</span>
            <span className="muted mono">{row.customerRef ?? ""}</span>
          </td>
          <td className="mono">{row.mid ?? ""}</td>
          <td className="truncate">{formatReasons(row.reasonsJson)}</td>
          <td><Badge text={row.status} /></td>
        </tr>
      )}
    />
  );
}

function RegionAssignmentView({
  state,
  regions,
  viewState,
  onViewStateChange,
  onDataChanged
}: {
  state: LoadState<Customer[]>;
  regions: Region[];
  viewState: CustomerPageViewState;
  onViewStateChange: Dispatch<SetStateAction<CustomerPageViewState>>;
  onDataChanged: () => void;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [targetRegionId, setTargetRegionId] = useState("");
  const [notice, setNotice] = useState<ArchiveNotice | null>(null);
  const [applying, setApplying] = useState(false);
  const [undoStack, setUndoStack] = useState<CustomerRegionAssignmentResult[][]>([]);
  const [redoStack, setRedoStack] = useState<CustomerRegionAssignmentResult[][]>([]);

  function handleSort(nextKey: CustomerPageSortKey) {
    if (viewState.sortKey === nextKey) {
      onViewStateChange((current) => ({
        ...current,
        sortDirection: current.sortDirection === "asc" ? "desc" : "asc"
      }));
      return;
    }

    onViewStateChange((current) => ({
      ...current,
      sortKey: nextKey,
      sortDirection: "asc"
    }));
  }

  const addedFromTime = parseDateTimeFilter(viewState.addedFrom);
  const addedToTime = parseDateTimeFilter(viewState.addedTo);

  const filteredData = state.data
    ?.filter((row) => {
      if (viewState.onlyCancelled && row.status !== "cancelled") {
        return false;
      }

      const postcodeQuery = viewState.postcodeText?.trim().toLowerCase() ?? "";
      if (postcodeQuery && !(row.postcode ?? "").toLowerCase().includes(postcodeQuery)) {
        return false;
      }

      if (viewState.regionId && String(row.regionId ?? "") !== viewState.regionId) {
        return false;
      }

      const addedTime = parseRowDateTime(row.addedAt);
      if (addedFromTime !== null && (addedTime === null || addedTime < addedFromTime)) {
        return false;
      }
      if (addedToTime !== null && (addedTime === null || addedTime > addedToTime)) {
        return false;
      }

      if (!viewState.searchText.trim()) {
        return true;
      }

      const query = viewState.searchText.trim().toLowerCase();
      return row.entityName.toLowerCase().includes(query) || (row.tradingName ?? "").toLowerCase().includes(query);
    })
    .sort((left, right) =>
      compareValues(getCustomerSortValue(left, viewState.sortKey), getCustomerSortValue(right, viewState.sortKey), viewState.sortDirection)
    );

  const visibleRows = filteredData ?? [];
  const visibleIds = visibleRows.map((row) => row.id);
  const selectedVisibleCount = visibleIds.filter((id) => selectedIds.has(id)).length;
  const allVisibleSelected = visibleIds.length > 0 && selectedVisibleCount === visibleIds.length;

  function toggleSelectAllVisible(checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const id of visibleIds) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  async function submitAssignments(assignments: { customerId: number; regionId: number | null }[]) {
    const response = await fetchWithActor(`${apiBase}/api/customers/region-assignments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignments })
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(payload?.error ?? `HTTP ${response.status}`);
    }

    return (await response.json()) as CustomerRegionAssignmentResult[];
  }

  async function assignSelected() {
    if (!targetRegionId) {
      setNotice({ kind: "error", message: "Choose a region to assign." });
      return;
    }

    const targets = visibleRows.filter((row) => selectedIds.has(row.id));
    if (!targets.length) {
      setNotice({ kind: "error", message: "Select at least one customer row." });
      return;
    }

    setApplying(true);
    setNotice(null);

    try {
      const results = await submitAssignments(targets.map((row) => ({
        customerId: row.id,
        regionId: Number(targetRegionId)
      })));
      setUndoStack((current) => [...current, results]);
      setRedoStack([]);
      setSelectedIds((current) => {
        const next = new Set(current);
        for (const row of targets) next.delete(row.id);
        return next;
      });
      onDataChanged();
      setNotice({
        kind: "success",
        message: `Assigned ${results.length} customer${results.length === 1 ? "" : "s"} to ${results[0]?.regionName ?? "the selected region"}.`
      });
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not assign region."
      });
    } finally {
      setApplying(false);
    }
  }

  async function undoLastAssignment() {
    const operation = undoStack.at(-1);
    if (!operation) return;

    setApplying(true);
    setNotice(null);

    try {
      await submitAssignments(operation.map((item) => ({
        customerId: item.customerId,
        regionId: item.previousRegionId ?? null
      })));
      setUndoStack((current) => current.slice(0, -1));
      setRedoStack((current) => [...current, operation]);
      onDataChanged();
      setNotice({
        kind: "success",
        message: `Undid region assignment for ${operation.length} customer${operation.length === 1 ? "" : "s"}.`
      });
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not undo region assignment."
      });
    } finally {
      setApplying(false);
    }
  }

  async function redoLastAssignment() {
    const operation = redoStack.at(-1);
    if (!operation) return;

    setApplying(true);
    setNotice(null);

    try {
      await submitAssignments(operation.map((item) => ({
        customerId: item.customerId,
        regionId: item.regionId ?? null
      })));
      setRedoStack((current) => current.slice(0, -1));
      setUndoStack((current) => [...current, operation]);
      onDataChanged();
      setNotice({
        kind: "success",
        message: `Redid region assignment for ${operation.length} customer${operation.length === 1 ? "" : "s"}.`
      });
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not redo region assignment."
      });
    } finally {
      setApplying(false);
    }
  }

  return (
    <>
      <section className="table-controls">
        <div className="table-search-group">
          <div className="table-search">
            <label htmlFor="region-assignment-search">Search customers</label>
            <input
              id="region-assignment-search"
              type="search"
              value={viewState.searchText}
              onChange={(event) => onViewStateChange((current) => ({ ...current, searchText: event.target.value }))}
              placeholder="Entity or trading name"
            />
          </div>
          <div className="table-search">
            <label htmlFor="region-assignment-postcode-search">Filter by postcode</label>
            <input
              id="region-assignment-postcode-search"
              type="search"
              value={viewState.postcodeText ?? ""}
              onChange={(event) => onViewStateChange((current) => ({ ...current, postcodeText: event.target.value }))}
              placeholder="Postcode"
            />
          </div>
          <div className="table-search">
            <label htmlFor="region-assignment-added-from">Added from</label>
            <input
              id="region-assignment-added-from"
              type="datetime-local"
              value={viewState.addedFrom ?? ""}
              onChange={(event) => onViewStateChange((current) => ({ ...current, addedFrom: event.target.value }))}
            />
          </div>
          <div className="table-search">
            <label htmlFor="region-assignment-added-to">Added to</label>
            <input
              id="region-assignment-added-to"
              type="datetime-local"
              value={viewState.addedTo ?? ""}
              onChange={(event) => onViewStateChange((current) => ({ ...current, addedTo: event.target.value }))}
            />
          </div>
          <div className="table-search table-search-compact">
            <label htmlFor="region-assignment-region-filter">Filter by region</label>
            <select
              id="region-assignment-region-filter"
              value={viewState.regionId ?? ""}
              onChange={(event) => onViewStateChange((current) => ({ ...current, regionId: event.target.value }))}
            >
              <option value="">All regions</option>
              {regions.map((region) => (
                <option key={region.id} value={region.id}>
                  {region.name}
                </option>
              ))}
            </select>
          </div>
          <div className="table-search table-search-compact">
            <label htmlFor="region-assignment-target-region">Assign to region</label>
            <select
              id="region-assignment-target-region"
              value={targetRegionId}
              onChange={(event) => setTargetRegionId(event.target.value)}
            >
              <option value="">Select region</option>
              {regions.map((region) => (
                <option key={region.id} value={region.id}>
                  {region.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="table-filter-actions">
          <label className="header-filter">
            <input
              type="checkbox"
              checked={viewState.onlyCancelled}
              onChange={(event) => onViewStateChange((current) => ({ ...current, onlyCancelled: event.target.checked }))}
            />
            <span>Cancelled only</span>
          </label>
          <button
            className="page-action-button"
            type="button"
            disabled={!selectedVisibleCount || !targetRegionId || applying}
            onClick={() => void assignSelected()}
          >
            {applying ? "Applying..." : "Assign To Region"}
          </button>
          <button
            className="secondary-action"
            type="button"
            disabled={!undoStack.length || applying}
            onClick={() => void undoLastAssignment()}
          >
            Undo
          </button>
          <button
            className="secondary-action"
            type="button"
            disabled={!redoStack.length || applying}
            onClick={() => void redoLastAssignment()}
          >
            Redo
          </button>
          <button
            className="secondary-action"
            type="button"
            onClick={() =>
              onViewStateChange({
                searchText: "",
                postcodeText: "",
                regionId: "",
                onlyCancelled: false,
                onlyMatched: false,
                addedFrom: "",
                addedTo: "",
                sortKey: "addedAt",
                sortDirection: "desc"
              })
            }
          >
            Reset
          </button>
        </div>
      </section>
      {notice && <StatusBanner kind={notice.kind} message={notice.message} />}
      <DataTable
        state={state.data ? { ...state, data: filteredData } : state}
        emptyMessage="No customers are available for region assignment."
        columns={[
          <label className="header-filter" key="region-assignment-select-all">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={(event) => toggleSelectAllVisible(event.target.checked)}
            />
            <span>Select</span>
          </label>,
          "Customer ref",
          renderSortHeader("Added", viewState.sortKey === "addedAt", viewState.sortDirection, () => handleSort("addedAt")),
          renderSortHeader("Entity", viewState.sortKey === "entityName", viewState.sortDirection, () => handleSort("entityName")),
          renderSortHeader("Trading name", viewState.sortKey === "tradingName", viewState.sortDirection, () => handleSort("tradingName")),
          "Region",
          renderSortHeader("Postcode", viewState.sortKey === "postcode", viewState.sortDirection, () => handleSort("postcode")),
          "Status"
        ]}
        renderRow={(row) => (
          <tr key={row.id} className={row.hasLead ? "lead-linked-row" : undefined}>
            <td>
              <input
                className="row-select-checkbox"
                type="checkbox"
                checked={selectedIds.has(row.id)}
                onChange={(event) =>
                  setSelectedIds((current) => {
                    const next = new Set(current);
                    if (event.target.checked) next.add(row.id);
                    else next.delete(row.id);
                    return next;
                  })
                }
                aria-label={`Select ${row.customerRef ?? row.entityName}`}
              />
            </td>
            <td className="mono">{row.customerRef ?? ""}</td>
            <td>{formatDateTime(row.addedAt)}</td>
            <td>{row.entityName}</td>
            <td>{row.tradingName ?? ""}</td>
            <td>{row.regionName ?? ""}</td>
            <td className="mono">{row.postcode ?? ""}</td>
            <td>{renderCustomerStatus(row.status, row.customerKind, row.hasNotes, row.hasOwnedChecklistMatch, row.customerValueTypeImageFileName, row.attachedProspectCount)}</td>
          </tr>
        )}
      />
    </>
  );
}

function LeadsView({
  state,
  users,
  campaigns,
  leadStatuses,
  onOpenLead,
  onRemoveLead,
  viewState,
  onViewStateChange,
  onOpenSelectedLeadsMap
}: {
  state: LoadState<Lead[]>;
  users: User[];
  campaigns: Campaign[];
  leadStatuses: LeadStatusOption[];
  onOpenLead: (leadId: number) => void;
  onRemoveLead: () => void;
  viewState: LeadViewState;
  onViewStateChange: Dispatch<SetStateAction<LeadViewState>>;
  onOpenSelectedLeadsMap: (leads: Lead[]) => void;
}) {
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<number>>(() => new Set());
  const [notice, setNotice] = useState<ArchiveNotice | null>(null);
  const pendingScrollRestoreRef = useRef<{ top: number; attempts: number } | null>(null);
  const [savingLeadPriorityId, setSavingLeadPriorityId] = useState<number | null>(null);

  function handleSort(nextKey: LeadViewState["sortKey"]) {
    if (viewState.sortKey === nextKey) {
      onViewStateChange((current) => ({
        ...current,
        sortDirection: current.sortDirection === "asc" ? "desc" : "asc"
      }));
      return;
    }

    onViewStateChange((current) => ({
      ...current,
      sortKey: nextKey,
      sortDirection: nextKey === "createdAt" ? "desc" : "asc"
    }));
  }

  const filteredLeads = state.data
    ?.filter((row) => {
      if (viewState.statusFilter !== "all" && row.leadStatus !== viewState.statusFilter) {
        return false;
      }

      if (viewState.priorityFilter !== "all" && row.leadPriority !== viewState.priorityFilter) {
        return false;
      }

      if (viewState.assignedUserId && String(row.assignedUserId ?? "") !== viewState.assignedUserId) {
        return false;
      }

      const query = viewState.searchText.trim().toLowerCase();
      if (!query) return true;

      return [
        row.customerName,
        row.customerRef,
        row.mid,
        row.tradingName,
        row.tradingAddress,
        row.contactPhone,
        row.contactEmail,
        row.postcode,
        row.leadStatus
      ]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(query));
    })
    .sort((left, right) =>
      compareValues(
        getLeadSortValue(left, viewState.sortKey),
        getLeadSortValue(right, viewState.sortKey),
        viewState.sortDirection
      )
    );

  const selectedCampaign = campaigns.find((campaign) => String(campaign.id) === viewState.selectedCampaignId);
  const availableWaves = selectedCampaign?.waves ?? [];
  const visibleLeadIds = filteredLeads?.map((row) => row.id) ?? [];
  const selectedVisibleCount = visibleLeadIds.filter((id) => selectedLeadIds.has(id)).length;
  const allVisibleSelected = visibleLeadIds.length > 0 && selectedVisibleCount === visibleLeadIds.length;
  const selectedVisibleLeads = filteredLeads?.filter((lead) => selectedLeadIds.has(lead.id)) ?? [];

  function toggleSelectAllVisible(checked: boolean) {
    setSelectedLeadIds((current) => {
      const next = new Set(current);
      for (const id of visibleLeadIds) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  async function addSelectedLeadsToWave() {
    if (!viewState.selectedWaveId) return;

    const leadIds = [...selectedLeadIds].filter((id) => visibleLeadIds.includes(id));
    if (!leadIds.length) return;

    setNotice(null);
    const response = await fetchWithActor(`${apiBase}/api/campaign-waves/${viewState.selectedWaveId}/leads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadIds })
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(payload?.error ?? `HTTP ${response.status}`);
    }

    setSelectedLeadIds(new Set());
    setNotice({ kind: "success", message: `${leadIds.length} lead${leadIds.length === 1 ? "" : "s"} added to wave.` });
  }

  async function assignLeadUser(leadId: number, assignedUserId: string) {
    setNotice(null);
    pendingScrollRestoreRef.current = { top: window.scrollY, attempts: 12 };
    const response = await fetchWithActor(`${apiBase}/api/leads/${leadId}/assigned-user`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignedUserId: assignedUserId ? Number(assignedUserId) : null })
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(payload?.error ?? `HTTP ${response.status}`);
    }
    onRemoveLead();
    setNotice({ kind: "success", message: "Lead assignment updated." });
  }

  async function updateLeadStatus(leadId: number, leadStatus: string) {
    setNotice(null);
    pendingScrollRestoreRef.current = { top: window.scrollY, attempts: 12 };
    const response = await fetchWithActor(`${apiBase}/api/leads/${leadId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadStatus })
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(payload?.error ?? `HTTP ${response.status}`);
    }
    onRemoveLead();
    setNotice({ kind: "success", message: "Lead status updated." });
  }

  async function updateLeadPriority(leadId: number, leadPriority: LeadPriority) {
    setNotice(null);
    setSavingLeadPriorityId(leadId);
    pendingScrollRestoreRef.current = { top: window.scrollY, attempts: 12 };
    const response = await fetchWithActor(`${apiBase}/api/leads/${leadId}/priority`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadPriority })
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      setSavingLeadPriorityId(null);
      throw new Error(payload?.error ?? `HTTP ${response.status}`);
    }
    setSavingLeadPriorityId(null);
    onRemoveLead();
    setNotice({ kind: "success", message: "Lead priority updated." });
  }

  useEffect(() => {
    const pending = pendingScrollRestoreRef.current;
    if (state.loading || !pending) {
      return;
    }

    let cancelled = false;
    const restore = () => {
      if (cancelled || !pendingScrollRestoreRef.current) {
        return;
      }

      const currentPending = pendingScrollRestoreRef.current;
      const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      const targetTop = Math.min(currentPending.top, maxScroll);
      window.scrollTo({ top: targetTop, behavior: "auto" });

      const closeEnough = Math.abs(window.scrollY - targetTop) <= 2;
      currentPending.attempts -= 1;
      if (closeEnough || currentPending.attempts <= 0) {
        pendingScrollRestoreRef.current = null;
        return;
      }

      requestAnimationFrame(restore);
    };

    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(restore);
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [state.loading, state.data]);

  function downloadCsv() {
    const params = new URLSearchParams();
    if (viewState.searchText.trim()) {
      params.set("searchText", viewState.searchText.trim());
    }
    if (viewState.statusFilter !== "all") {
      params.set("status", viewState.statusFilter);
    }
    if (viewState.assignedUserId) {
      params.set("assignedUserId", viewState.assignedUserId);
    }

    const url = `${apiBase}/api/leads/export${params.toString() ? `?${params.toString()}` : ""}`;
    const link = document.createElement("a");
    link.href = url;
    link.download = "leads.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  return (
    <>
      <section className="table-controls">
        <div className="table-search-group table-search-group-inline">
          <div className="table-search table-search-compact">
            <label htmlFor="lead-page-search">Search leads</label>
            <input
              id="lead-page-search"
              type="search"
              value={viewState.searchText}
              onChange={(event) => onViewStateChange((current) => ({ ...current, searchText: event.target.value }))}
              placeholder="Customer, trading name, phone, email, ref, MID, postcode"
            />
          </div>
          <div className="table-search table-search-compact">
            <label htmlFor="lead-user-select">User</label>
            <select
              id="lead-user-select"
              className="header-select"
              value={viewState.assignedUserId}
              onChange={(event) => onViewStateChange((current) => ({ ...current, assignedUserId: event.target.value }))}
            >
              <option value="">All users</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.fullName}
                </option>
              ))}
            </select>
          </div>
          <div className="table-search table-search-compact">
            <label htmlFor="lead-priority-select">Priority</label>
            <select
              id="lead-priority-select"
              className="header-select"
              value={viewState.priorityFilter}
              onChange={(event) => onViewStateChange((current) => ({ ...current, priorityFilter: event.target.value }))}
            >
              <option value="all">All priorities</option>
              {leadPriorityOrder.map((priority) => (
                <option key={priority} value={priority}>
                  {getLeadPriorityLabel(priority)}
                </option>
              ))}
            </select>
          </div>
          <div className="table-search table-search-compact">
            <label htmlFor="lead-campaign-select">Campaign</label>
            <select
              id="lead-campaign-select"
              className="header-select"
              value={viewState.selectedCampaignId}
              onChange={(event) =>
                onViewStateChange((current) => ({
                  ...current,
                  selectedCampaignId: event.target.value,
                  selectedWaveId: ""
                }))
              }
            >
              <option value="">Select campaign</option>
              {campaigns.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.name}
                </option>
              ))}
            </select>
          </div>
          <div className="table-search table-search-compact">
            <label htmlFor="lead-wave-select">Wave</label>
            <select
              id="lead-wave-select"
              className="header-select"
              value={viewState.selectedWaveId}
              onChange={(event) => onViewStateChange((current) => ({ ...current, selectedWaveId: event.target.value }))}
              disabled={!viewState.selectedCampaignId}
            >
              <option value="">Select wave</option>
              {availableWaves.map((wave) => (
                <option key={wave.id} value={wave.id}>
                  {wave.waveNumber}. {wave.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="table-filter-actions">
          <button
            className="page-action-button"
            type="button"
            disabled={!viewState.selectedWaveId || selectedVisibleCount === 0}
            onClick={() => void addSelectedLeadsToWave()}
          >
            Add Leads To Wave
          </button>
          <button
            className="secondary-action"
            type="button"
            disabled={selectedVisibleLeads.length === 0}
            onClick={() => onOpenSelectedLeadsMap(selectedVisibleLeads)}
          >
            View Selected On Map
          </button>
          <button className="secondary-action" type="button" onClick={downloadCsv}>
            Download CSV
          </button>
          <button
            className="secondary-action"
            type="button"
              onClick={() =>
              onViewStateChange({
                searchText: "",
                statusFilter: "all",
                priorityFilter: "all",
                assignedUserId: "",
                selectedCampaignId: "",
                selectedWaveId: "",
                sortKey: "createdAt",
                sortDirection: "desc"
              })
            }
          >
            Reset
          </button>
        </div>
      </section>
      {notice && <StatusBanner kind={notice.kind} message={notice.message} />}
      <DataTable
        state={state.data ? { ...state, data: filteredLeads } : state}
        emptyMessage="No leads have been created yet."
        columns={[
        <label className="header-filter" key="lead-select-all">
          <input
            type="checkbox"
            checked={allVisibleSelected}
            onChange={(event) => toggleSelectAllVisible(event.target.checked)}
          />
          <span>Select</span>
        </label>,
        renderSortHeader("Lead", viewState.sortKey === "id", viewState.sortDirection, () => handleSort("id")),
        renderSortHeader("Customer", viewState.sortKey === "customerName", viewState.sortDirection, () => handleSort("customerName")),
        renderSortHeader("User", viewState.sortKey === "assignedUserName", viewState.sortDirection, () => handleSort("assignedUserName")),
        renderSortHeader("Trading name", viewState.sortKey === "tradingName", viewState.sortDirection, () => handleSort("tradingName")),
        "Phone",
        "Email",
        renderSortHeader("Postcode", viewState.sortKey === "postcode", viewState.sortDirection, () => handleSort("postcode")),
        renderSortHeader("Priority", viewState.sortKey === "leadPriority", viewState.sortDirection, () => handleSort("leadPriority")),
        renderSortHeader("Prospects", viewState.sortKey === "prospectCount", viewState.sortDirection, () => handleSort("prospectCount")),
        renderSortHeader("Contact history", viewState.sortKey === "contactHistoryCount", viewState.sortDirection, () => handleSort("contactHistoryCount")), (
          <select
            key="lead-status-filter"
            className="header-select"
            value={viewState.statusFilter}
            onChange={(event) => onViewStateChange((current) => ({ ...current, statusFilter: event.target.value }))}
          >
            <option value="all">All statuses</option>
            {leadStatuses.map((status) => (
              <option key={status.id} value={status.name}>
                {status.name}
              </option>
            ))}
          </select>
        ), renderSortHeader("Created", viewState.sortKey === "createdAt", viewState.sortDirection, () => handleSort("createdAt"))]}
        renderRow={(row) => (
          <tr key={row.id}>
            <td>
              <input
                className="row-select-checkbox"
                type="checkbox"
                checked={selectedLeadIds.has(row.id)}
                onChange={(event) =>
                  setSelectedLeadIds((current) => {
                    const next = new Set(current);
                    if (event.target.checked) next.add(row.id);
                    else next.delete(row.id);
                    return next;
                  })
                }
                aria-label={`Select lead ${row.id}`}
              />
            </td>
            <td>
              <button className="row-link" type="button" onClick={() => onOpenLead(row.id)}>
                Lead #{row.id}
              </button>
            </td>
            <td>
              <span className="stacked">{row.customerName}</span>
            </td>
            <td>
              <select
                className="header-select"
                value={row.assignedUserId ? String(row.assignedUserId) : ""}
                onChange={(event) => void assignLeadUser(row.id, event.target.value)}
              >
                <option value="">Unassigned</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.fullName}
                  </option>
                ))}
              </select>
            </td>
            <td>{row.tradingName ?? ""}</td>
            <td>{row.contactPhone ?? ""}</td>
            <td><CopyableEmail email={row.contactEmail} /></td>
            <td className="mono">{row.postcode ?? ""}</td>
            <td>
              <LeadPriorityLights
                value={row.leadPriority}
                disabled={savingLeadPriorityId === row.id}
                onChange={(priority) => void updateLeadPriority(row.id, priority)}
              />
            </td>
            <td>{row.prospectCount}</td>
            <td>{row.contactHistoryCount}</td>
            <td>
              <select
                className="header-select"
                value={row.leadStatus}
                onChange={(event) => void updateLeadStatus(row.id, event.target.value)}
              >
                {leadStatuses.map((status) => (
                  <option key={status.id} value={status.name}>
                    {status.name}
                  </option>
                ))}
              </select>
            </td>
            <td>{formatDateTime(row.createdAt)}</td>
          </tr>
        )}
      />
    </>
  );
}

function LeadDetailView({
  leadId,
  onBack,
  onOpenCustomer,
  onLeadChanged,
  users,
  leadStatuses,
  customerValueTypes,
  defaultUserId
}: {
  leadId: number;
  onBack: () => void;
  onOpenCustomer: (customerId: number) => void;
  onLeadChanged: () => void;
  users: User[];
  leadStatuses: LeadStatusOption[];
  customerValueTypes: CustomerValueType[];
  defaultUserId: string;
}) {
  const [refreshKey, setRefreshKey] = useState(0);
  const state = useApi<LeadDetail>(`/api/leads/${leadId}`, refreshKey);
  const [removed, setRemoved] = useState(false);
  const [notice, setNotice] = useState<ArchiveNotice | null>(null);
  const [historyForm, setHistoryForm] = useState<LeadContactHistoryFormState>({
    channel: "email",
    contactedAt: "",
    reason: "",
    whoBy: "",
    responseStatus: ""
  });
  const [savingHistory, setSavingHistory] = useState(false);
  const [savingPrimaryProspectId, setSavingPrimaryProspectId] = useState<string | null>(null);
  const [savingLeadPriority, setSavingLeadPriority] = useState(false);
  const [noteForm, setNoteForm] = useState<LeadNoteFormState>({
    noteText: "",
    notedAt: "",
    userId: defaultUserId
  });
  const [savingNote, setSavingNote] = useState(false);
  const userNameById = useMemo(
    () => new Map(users.map((user) => [String(user.id), user.fullName])),
    [users]
  );
  const [commercials, setCommercials] = useState<CustomerCommercials | undefined>(state.data?.commercials);
  const noteEntries = useMemo(
    () => state.data?.contactHistory.filter((entry) => entry.channel === "other" && !!entry.notes?.trim()) ?? [],
    [state.data]
  );
  const contactEntries = useMemo(
    () => state.data?.contactHistory.filter((entry) => !(entry.channel === "other" && !!entry.notes?.trim())) ?? [],
    [state.data]
  );

  useEffect(() => {
    setNoteForm((current) => (
      current.userId || !defaultUserId
        ? current
        : { ...current, userId: defaultUserId }
    ));
  }, [defaultUserId]);

  useEffect(() => {
    setCommercials(state.data?.commercials);
  }, [state.data]);

  async function removeLead() {
    const response = await fetchWithActor(`${apiBase}/api/leads/${leadId}`, { method: "DELETE" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    setRemoved(true);
    onLeadChanged();
  }

  async function updateLeadStatus(leadStatus: string) {
    setNotice(null);
    const response = await fetchWithActor(`${apiBase}/api/leads/${leadId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadStatus })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    setRefreshKey((current) => current + 1);
    onLeadChanged();
  }

  async function updateLeadPriority(leadPriority: LeadPriority) {
    setSavingLeadPriority(true);
    setNotice(null);
    try {
      const response = await fetchWithActor(`${apiBase}/api/leads/${leadId}/priority`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadPriority })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setRefreshKey((current) => current + 1);
      onLeadChanged();
    } finally {
      setSavingLeadPriority(false);
    }
  }

  async function setPrimaryProspect(prospectId: string) {
    setSavingPrimaryProspectId(prospectId);
    setNotice(null);

    try {
      const response = await fetchWithActor(`${apiBase}/api/leads/${leadId}/primary-prospect`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prospectId })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? `HTTP ${response.status}`);
      }
      setNotice({ kind: "success", message: `Primary prospect updated to ${prospectId}.` });
      setRefreshKey((current) => current + 1);
      onLeadChanged();
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not update primary prospect."
      });
    } finally {
      setSavingPrimaryProspectId(null);
    }
  }

  async function addContactHistory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingHistory(true);

    try {
          const response = await fetchWithActor(`${apiBase}/api/leads/${leadId}/contact-history`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              channel: historyForm.channel,
              contactedAt: historyForm.contactedAt || null,
              reason: historyForm.reason || null,
              whoBy: historyForm.whoBy || null,
              responseStatus: historyForm.responseStatus || null,
              notes: null
            })
          });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setHistoryForm({
        channel: "email",
        contactedAt: "",
        reason: "",
        whoBy: "",
        responseStatus: ""
      });
      setRefreshKey((current) => current + 1);
      onLeadChanged();
    } finally {
      setSavingHistory(false);
    }
  }

  async function addLeadNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingNote(true);

    try {
      const selectedUserName = noteForm.userId ? (userNameById.get(noteForm.userId) ?? "") : "";
      const response = await fetchWithActor(`${apiBase}/api/leads/${leadId}/contact-history`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: "other",
          contactedAt: noteForm.notedAt || null,
          reason: null,
          whoBy: selectedUserName || null,
          responseStatus: null,
          notes: noteForm.noteText
        })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setNoteForm({
        noteText: "",
        notedAt: "",
        userId: defaultUserId
      });
      setRefreshKey((current) => current + 1);
      onLeadChanged();
    } finally {
      setSavingNote(false);
    }
  }

  if (removed) return <EmptyPanel message="Lead removed." />;
  if (state.loading) return <PanelSkeleton />;
  if (state.error) return <ErrorPanel error={state.error} />;
  if (!state.data) return <EmptyPanel message="Lead not found." />;
  const lead = state.data;

  return (
    <section className="detail-panel">
      <div className="page-actions">
        <button className="secondary-action" type="button" onClick={onBack}>
          Back
        </button>
      </div>
      <div className="detail-header">
        <div>
          <span className="eyebrow">Lead</span>
          <h3>{lead.customerName}</h3>
          <p className="mono">Lead #{lead.id}</p>
        </div>
        <div className="panel-actions">
          <button className="secondary-action" type="button" onClick={() => onOpenCustomer(lead.customerId)}>
            View Customer
          </button>
          <LeadPriorityLights
            value={lead.leadPriority}
            disabled={savingLeadPriority}
            onChange={(priority) => void updateLeadPriority(priority)}
          />
          <select
            className="header-select"
            value={lead.leadStatus}
            onChange={(event) => void updateLeadStatus(event.target.value)}
          >
            {leadStatuses.map((status) => (
              <option key={status.id} value={status.name}>
                {status.name}
              </option>
            ))}
          </select>
          <button className="secondary-action destructive-action" type="button" onClick={() => void removeLead()}>
            Remove Lead
          </button>
        </div>
      </div>
      {notice && <StatusBanner kind={notice.kind} message={notice.message} />}
      <div className="detail-grid">
        <DetailItem label="Trading name" value={lead.tradingName} />
        <DetailItem label="Address" value={lead.tradingAddress} />
        <DetailItem label="Postcode" value={lead.postcode} />
        <DetailItem label="Primary email" value={<CopyableEmail email={lead.contactEmail} />} />
        <DetailItem label="Priority" value={getLeadPriorityLabel(lead.leadPriority)} />
        <DetailItem label="Created" value={formatDateTime(lead.createdAt)} />
      </div>
      <div className="detail-grid">
        <CommercialsEditor
          customerId={state.data.customerId}
          title="Commercials"
          value={commercials}
          customerValueTypes={customerValueTypes}
          onSaved={(next) => {
            setCommercials(next);
            onLeadChanged();
          }}
        />
      </div>

      <div className="match-list">
        <article className="match-card">
          <div className="match-card-header">
            <div>
              <strong>Prospect links</strong>
              <div className="muted">{lead.prospects.length} linked prospect{lead.prospects.length === 1 ? "" : "s"}</div>
            </div>
          </div>
          <div className="match-card-grid">
            {lead.prospects.map((prospect) => (
              <div className="detail-item" key={prospect.prospectId}>
                <div className="row-actions">
                  <span>{prospect.isPrimary ? "Primary prospect" : "Prospect"}</span>
                  {lead.prospects.length > 1 && !prospect.isPrimary && (
                    <button
                      className="secondary-action"
                      type="button"
                      disabled={savingPrimaryProspectId === prospect.prospectId}
                      onClick={() => void setPrimaryProspect(prospect.prospectId)}
                    >
                      {savingPrimaryProspectId === prospect.prospectId ? "Saving..." : "Make primary"}
                    </button>
                  )}
                </div>
                <strong>{prospect.businessName}</strong>
                <div className="muted mono">{prospect.prospectId}</div>
                <div>{prospect.contactName ?? ""}</div>
                <div><CopyableEmail email={prospect.contactEmail} /></div>
                <div>{prospect.ownerName ?? ""}</div>
                <div>{prospect.addressLine1 ?? ""}</div>
                <div>{prospect.postcode ?? ""}</div>
              </div>
            ))}
          </div>
        </article>

        <article className="match-card">
          <div className="match-card-header">
            <div>
              <strong>Contact history</strong>
              <div className="muted">{contactEntries.length} contact event{contactEntries.length === 1 ? "" : "s"}</div>
            </div>
          </div>
          <form className="search-form" onSubmit={(event) => void addContactHistory(event)}>
            <div className="table-search-group">
              <div className="table-search">
                <label htmlFor="lead-history-channel">Channel</label>
                <select
                  id="lead-history-channel"
                  className="header-select"
                  value={historyForm.channel}
                  onChange={(event) => setHistoryForm((current) => ({ ...current, channel: event.target.value }))}
                >
                  <option value="email">Email</option>
                  <option value="mail">Mail</option>
                  <option value="phone_call">Phone call</option>
                  <option value="sms">SMS</option>
                  <option value="in_person">In person</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="table-search">
                <label htmlFor="lead-history-contacted-at">Date/time</label>
                <input
                  id="lead-history-contacted-at"
                  type="datetime-local"
                  value={historyForm.contactedAt}
                  onChange={(event) => setHistoryForm((current) => ({ ...current, contactedAt: event.target.value }))}
                />
              </div>
              <div className="table-search">
                <label htmlFor="lead-history-response-status">Response status</label>
                <select
                  id="lead-history-response-status"
                  className="header-select"
                  value={historyForm.responseStatus}
                  onChange={(event) => setHistoryForm((current) => ({ ...current, responseStatus: event.target.value }))}
                >
                  <option value="">None</option>
                  <option value="Suppressed">Suppressed</option>
                  <option value="Scheduled">Scheduled</option>
                  <option value="Sent">Sent</option>
                  <option value="Called">Called</option>
                  <option value="Visited">Visited</option>
                  <option value="Responded">Responded</option>
                  <option value="Interested">Interested</option>
                  <option value="Converted">Converted</option>
                  <option value="Not interested">Not interested</option>
                  <option value="Failed">Failed</option>
                  <option value="Removed">Removed</option>
                  <option value="Dead Lead">Dead Lead</option>
                </select>
              </div>
            </div>
            <div className="table-search-group">
              <div className="table-search">
                <label htmlFor="lead-history-reason">Reason</label>
                <input
                  id="lead-history-reason"
                  type="text"
                  value={historyForm.reason}
                  onChange={(event) => setHistoryForm((current) => ({ ...current, reason: event.target.value }))}
                />
              </div>
              <div className="table-search">
                <label htmlFor="lead-history-who-by">Who by</label>
                <input
                  id="lead-history-who-by"
                  type="text"
                  value={historyForm.whoBy}
                  onChange={(event) => setHistoryForm((current) => ({ ...current, whoBy: event.target.value }))}
                />
              </div>
            </div>
            <div className="page-actions">
              <button className="secondary-action" type="submit" disabled={savingHistory}>
                {savingHistory ? "Saving..." : "Add Contact Entry"}
              </button>
            </div>
          </form>
          {contactEntries.length ? (
            <div className="match-card-grid">
              {contactEntries.map((entry) => (
                <div className="detail-item" key={entry.id}>
                  <span>{formatLeadChannel(entry.channel)}</span>
                  <strong>{formatDateTime(entry.contactedAt)}</strong>
                  <div>{entry.reason ?? entry.outcome ?? ""}</div>
                  <div>{entry.whoBy ?? ""}</div>
                  <div>{entry.responseStatus ?? ""}</div>
                  <div>{entry.notes ?? ""}</div>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">No contact history yet.</p>
          )}
        </article>

        <article className="match-card">
          <div className="match-card-header">
            <div>
              <strong>Notes</strong>
              <div className="muted">{noteEntries.length} note{noteEntries.length === 1 ? "" : "s"}</div>
            </div>
          </div>
          <form className="search-form" onSubmit={(event) => void addLeadNote(event)}>
            <div className="table-search-group">
              <div className="table-search">
                <label htmlFor="lead-note-user">User</label>
                <select
                  id="lead-note-user"
                  className="header-select"
                  value={noteForm.userId}
                  onChange={(event) => setNoteForm((current) => ({ ...current, userId: event.target.value }))}
                >
                  <option value="">None</option>
                  {users.map((user) => (
                    <option key={user.id} value={String(user.id)}>
                      {user.fullName}
                    </option>
                  ))}
                </select>
              </div>
              <div className="table-search">
                <label htmlFor="lead-note-noted-at">Date/time</label>
                <input
                  id="lead-note-noted-at"
                  type="datetime-local"
                  value={noteForm.notedAt}
                  onChange={(event) => setNoteForm((current) => ({ ...current, notedAt: event.target.value }))}
                />
              </div>
            </div>
            <div className="table-search">
              <label htmlFor="lead-note-text">Note</label>
              <textarea
                id="lead-note-text"
                rows={5}
                value={noteForm.noteText}
                onChange={(event) => setNoteForm((current) => ({ ...current, noteText: event.target.value }))}
              />
            </div>
            <div className="page-actions">
              <button className="secondary-action" type="submit" disabled={savingNote || !noteForm.noteText.trim()}>
                {savingNote ? "Saving..." : "Add Note"}
              </button>
            </div>
          </form>
          {noteEntries.length ? (
            <div className="match-card-grid">
              {noteEntries.map((entry) => (
                <div className="detail-item" key={entry.id}>
                  <span>{entry.whoBy ?? "No user"}</span>
                  <strong>{formatDateTime(entry.contactedAt)}</strong>
                  <div className="note-text">{entry.notes ?? ""}</div>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">No notes yet.</p>
          )}
        </article>
      </div>
    </section>
  );
}

function ComplianceView({
  state,
  form,
  onFormChange,
  onDataChanged
}: {
  state: LoadState<GdprEntry[]>;
  form: GdprFormState;
  onFormChange: Dispatch<SetStateAction<GdprFormState>>;
  onDataChanged: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<ArchiveNotice | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setNotice(null);

    try {
      const response = await fetchWithActor(`${apiBase}/api/gdpr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? `HTTP ${response.status}`);
      }

      onFormChange({ emailAddress: "", name: "", address: "" });
      setNotice({ kind: "success", message: "GDPR entry added." });
      onDataChanged();
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not add GDPR entry."
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="test-page">
      <form className="search-form" onSubmit={(event) => void submit(event)}>
        <label htmlFor="gdpr-email">Email address</label>
        <input
          id="gdpr-email"
          type="email"
          value={form.emailAddress}
          onChange={(event) => onFormChange((current) => ({ ...current, emailAddress: event.target.value }))}
          placeholder="name@example.com"
        />
        <label htmlFor="gdpr-name">Name</label>
        <input
          id="gdpr-name"
          type="text"
          value={form.name}
          onChange={(event) => onFormChange((current) => ({ ...current, name: event.target.value }))}
          placeholder="Business or contact name"
        />
        <label htmlFor="gdpr-address">Address</label>
        <input
          id="gdpr-address"
          type="text"
          value={form.address}
          onChange={(event) => onFormChange((current) => ({ ...current, address: event.target.value }))}
          placeholder="Address"
        />
        <div className="page-actions">
          <button className="page-action-button" type="submit" disabled={submitting}>
            {submitting ? "Saving..." : "Add GDPR entry"}
          </button>
        </div>
      </form>
      {notice && <StatusBanner kind={notice.kind} message={notice.message} />}
      <DataTable
        state={state}
        emptyMessage="No GDPR entries yet."
        columns={["Created", "Email address", "Name", "Address"]}
        renderRow={(row) => (
          <tr key={row.id}>
            <td>{formatDateTime(row.createdAt)}</td>
            <td>{row.emailAddress ?? ""}</td>
            <td>{row.name ?? ""}</td>
            <td>{row.address ?? ""}</td>
          </tr>
        )}
      />
    </div>
  );
}

function UsersView({
  state,
  form,
  onFormChange,
  onDataChanged
}: {
  state: LoadState<User[]>;
  form: UserFormState;
  onFormChange: Dispatch<SetStateAction<UserFormState>>;
  onDataChanged: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [savingColorUserId, setSavingColorUserId] = useState<number | null>(null);
  const [notice, setNotice] = useState<ArchiveNotice | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setNotice(null);

    try {
      const response = await fetchWithActor(`${apiBase}/api/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? `HTTP ${response.status}`);
      }

      onFormChange({ fullName: "", initials: "", phone: "", email: "", color: userColorOptions[0].value });
      setNotice({ kind: "success", message: "User added." });
      onDataChanged();
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not add user."
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function updateUserColor(user: User, color: string) {
    setSavingColorUserId(user.id);
    setNotice(null);

    try {
      const response = await fetchWithActor(`${apiBase}/api/users/${user.id}/color`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ color })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? `HTTP ${response.status}`);
      }

      setNotice({ kind: "success", message: `${user.fullName} colour updated.` });
      onDataChanged();
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not update user colour."
      });
    } finally {
      setSavingColorUserId(null);
    }
  }

  return (
    <div className="test-page">
      <form className="search-form" onSubmit={(event) => void submit(event)}>
        <div className="table-search-group">
          <div className="table-search">
            <label htmlFor="user-full-name">Name</label>
            <input
              id="user-full-name"
              type="text"
              value={form.fullName}
              onChange={(event) => onFormChange((current) => ({ ...current, fullName: event.target.value }))}
              placeholder="Full name"
            />
          </div>
          <div className="table-search table-search-compact">
            <label htmlFor="user-initials">Initials</label>
            <input
              id="user-initials"
              type="text"
              value={form.initials}
              onChange={(event) => onFormChange((current) => ({ ...current, initials: event.target.value }))}
              placeholder="DC"
            />
          </div>
        </div>
        <div className="table-search-group">
          <div className="table-search">
            <label htmlFor="user-phone">Contact phone number</label>
            <input
              id="user-phone"
              type="text"
              value={form.phone}
              onChange={(event) => onFormChange((current) => ({ ...current, phone: event.target.value }))}
              placeholder="Phone number"
            />
          </div>
          <div className="table-search">
            <label htmlFor="user-email">Email</label>
            <input
              id="user-email"
              type="email"
              value={form.email}
              onChange={(event) => onFormChange((current) => ({ ...current, email: event.target.value }))}
              placeholder="name@example.com"
            />
          </div>
          <div className="table-search table-search-compact">
            <label htmlFor="user-color">Colour</label>
            <select
              id="user-color"
              value={form.color}
              onChange={(event) => onFormChange((current) => ({ ...current, color: event.target.value }))}
            >
              {userColorOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="page-actions">
          <button className="page-action-button" type="submit" disabled={submitting}>
            {submitting ? "Saving..." : "Add user"}
          </button>
        </div>
      </form>
      {notice && <StatusBanner kind={notice.kind} message={notice.message} />}
      <DataTable
        state={state}
        emptyMessage="No users added yet."
        columns={["Created", "Name", "Initials", "Phone", "Email", "Colour"]}
        renderRow={(row) => (
          <tr key={row.id}>
            <td>{formatDateTime(row.createdAt)}</td>
            <td>{row.fullName}</td>
            <td className="mono">{row.initials}</td>
            <td>{row.phone ?? ""}</td>
            <td>{row.email ?? ""}</td>
            <td>
              <div className="user-color-cell">
                <span className="bookmark-dot user-color-preview" aria-hidden style={{ backgroundColor: row.color ?? "#111111" }} />
                <select
                  className="header-select"
                  value={row.color ?? userColorOptions[0].value}
                  disabled={savingColorUserId === row.id}
                  onChange={(event) => void updateUserColor(row, event.target.value)}
                >
                  {userColorOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </td>
          </tr>
        )}
      />
    </div>
  );
}

function RegionsView({
  state,
  form,
  onFormChange,
  onDataChanged
}: {
  state: LoadState<Region[]>;
  form: RegionFormState;
  onFormChange: Dispatch<SetStateAction<RegionFormState>>;
  onDataChanged: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");
  const [notice, setNotice] = useState<ArchiveNotice | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setNotice(null);

    try {
      const response = await fetchWithActor(`${apiBase}/api/regions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? `HTTP ${response.status}`);
      }

      onFormChange({ name: "" });
      setNotice({ kind: "success", message: "Region added." });
      onDataChanged();
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not add region."
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function saveEdit(regionId: number) {
    setSubmitting(true);
    setNotice(null);

    try {
      const response = await fetchWithActor(`${apiBase}/api/regions/${regionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editingName })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? `HTTP ${response.status}`);
      }

      setEditingId(null);
      setEditingName("");
      setNotice({ kind: "success", message: "Region updated." });
      onDataChanged();
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not update region."
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="test-page">
      <form className="search-form" onSubmit={(event) => void submit(event)}>
        <div className="table-search-group">
          <div className="table-search">
            <label htmlFor="region-name">Region name</label>
            <input
              id="region-name"
              type="text"
              value={form.name}
              onChange={(event) => onFormChange({ name: event.target.value })}
              placeholder="South East"
            />
          </div>
        </div>
        <div className="page-actions">
          <button className="page-action-button" type="submit" disabled={submitting}>
            {submitting ? "Saving..." : "Add region"}
          </button>
        </div>
      </form>
      {notice && <StatusBanner kind={notice.kind} message={notice.message} />}
      <DataTable
        state={state}
        emptyMessage="No regions added yet."
        columns={["Created", "Region", "Updated", "Action"]}
        renderRow={(row) => (
          <tr key={row.id}>
            <td>{formatDateTime(row.createdAt)}</td>
            <td>
              {editingId === row.id ? (
                <input
                  type="text"
                  value={editingName}
                  onChange={(event) => setEditingName(event.target.value)}
                  className="inline-table-input"
                />
              ) : (
                row.name
              )}
            </td>
            <td>{formatDateTime(row.updatedAt)}</td>
            <td>
              {editingId === row.id ? (
                <div className="row-actions">
                  <button className="details-button" type="button" disabled={submitting} onClick={() => void saveEdit(row.id)}>
                    Save
                  </button>
                  <button
                    className="secondary-action"
                    type="button"
                    disabled={submitting}
                    onClick={() => {
                      setEditingId(null);
                      setEditingName("");
                    }}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  className="details-button"
                  type="button"
                  onClick={() => {
                    setEditingId(row.id);
                    setEditingName(row.name);
                  }}
                >
                  Edit
                </button>
              )}
            </td>
          </tr>
        )}
      />
    </div>
  );
}

function buildSicOptionLabel(sicCode: CompanySicCode) {
  return `${sicCode.code} - ${sicCode.description}`;
}

function extractSicCode(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const separatorIndex = trimmed.indexOf(" - ");
  return separatorIndex >= 0 ? trimmed.slice(0, separatorIndex).trim() : trimmed;
}

function getCustomerValueTypeImagePath(imageFileName: string) {
  return `/customer-value-shields/${imageFileName}`;
}

function BusinessTypesView({
  state,
  sicCodes,
  form,
  onFormChange,
  onDataChanged
}: {
  state: LoadState<BusinessType[]>;
  sicCodes: CompanySicCode[];
  form: BusinessTypeFormState;
  onFormChange: Dispatch<SetStateAction<BusinessTypeFormState>>;
  onDataChanged: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingSicCodeInput, setEditingSicCodeInput] = useState("");
  const [customSearchText, setCustomSearchText] = useState("");
  const [sicSearchText, setSicSearchText] = useState("");
  const [notice, setNotice] = useState<ArchiveNotice | null>(null);
  const createSicCode = extractSicCode(form.sicCodeInput);
  const filteredBusinessTypes = useMemo(() => {
    const needle = normalizeMatchText(customSearchText);
    if (!needle) {
      return state.data ?? [];
    }

    return (state.data ?? []).filter((row) =>
      [
        row.name,
        row.sicCode ?? "",
        row.sicDescription ?? ""
      ]
        .map((value) => normalizeMatchText(value))
        .some((value) => value.includes(needle))
    );
  }, [customSearchText, state.data]);
  const filteredSicCodes = useMemo(() => {
    const needle = normalizeMatchText(sicSearchText);
    if (!needle) {
      return sicCodes;
    }

    return sicCodes.filter((row) =>
      [row.code, row.description]
        .map((value) => normalizeMatchText(value))
        .some((value) => value.includes(needle))
    );
  }, [sicCodes, sicSearchText]);
  const businessTypeState: LoadState<BusinessType[]> = {
    data: filteredBusinessTypes,
    error: state.error,
    loading: state.loading
  };
  const sicCodeState: LoadState<CompanySicCode[]> = { data: filteredSicCodes, loading: false };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setNotice(null);

    try {
      const response = await fetchWithActor(`${apiBase}/api/business-types`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          sicCode: createSicCode || null
        })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? `HTTP ${response.status}`);
      }

      onFormChange({ name: "", sicCodeInput: "" });
      setNotice({ kind: "success", message: "Business type added." });
      onDataChanged();
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not add business type."
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function saveEdit(businessTypeId: number) {
    setSubmitting(true);
    setNotice(null);

    try {
      const response = await fetchWithActor(`${apiBase}/api/business-types/${businessTypeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editingName,
          sicCode: extractSicCode(editingSicCodeInput) || null
        })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? `HTTP ${response.status}`);
      }

      setEditingId(null);
      setEditingName("");
      setEditingSicCodeInput("");
      setNotice({ kind: "success", message: "Business type updated." });
      onDataChanged();
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not update business type."
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="test-page">
      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Custom Types</p>
            <h3>Additional Business Types</h3>
          </div>
        </div>
        <form className="search-form" onSubmit={(event) => void submit(event)}>
          <div className="table-search-group">
            <div className="table-search">
              <label htmlFor="business-type-name">Business type</label>
              <input
                id="business-type-name"
                type="text"
                value={form.name}
                onChange={(event) => onFormChange((current) => ({ ...current, name: event.target.value }))}
                placeholder="Barbers"
              />
            </div>
            <div className="table-search">
              <label htmlFor="business-type-sic">Companies House SIC code</label>
              <input
                id="business-type-sic"
                type="text"
                list="company-sic-codes-list"
                value={form.sicCodeInput}
                onChange={(event) => onFormChange((current) => ({ ...current, sicCodeInput: event.target.value }))}
                placeholder="Optional"
              />
            </div>
          </div>
          <div className="page-actions">
            <button className="page-action-button" type="submit" disabled={submitting}>
              {submitting ? "Saving..." : "Add business type"}
            </button>
          </div>
        </form>
        <datalist id="company-sic-codes-list">
          {sicCodes.map((sicCode) => (
            <option key={sicCode.code} value={buildSicOptionLabel(sicCode)} />
          ))}
        </datalist>
        <div className="search-form">
          <div className="table-search-group">
            <div className="table-search">
              <label htmlFor="business-type-search">Search business types</label>
              <input
                id="business-type-search"
                type="search"
                value={customSearchText}
                onChange={(event) => setCustomSearchText(event.target.value)}
                placeholder="Search name or SIC"
              />
            </div>
          </div>
        </div>
        <p className="helper-copy">Add your own extra business types here. Linking a SIC code is optional.</p>
        {notice && <StatusBanner kind={notice.kind} message={notice.message} />}
        <DataTable
          state={businessTypeState}
          emptyMessage="No business types added yet."
          columns={["Created", "Business type", "SIC code", "SIC description", "Updated", "Action"]}
          renderRow={(row) => (
            <tr key={row.id}>
              <td>{formatDateTime(row.createdAt)}</td>
              <td>
                {editingId === row.id ? (
                  <input
                    type="text"
                    value={editingName}
                    onChange={(event) => setEditingName(event.target.value)}
                    className="inline-table-input"
                  />
                ) : (
                  row.name
                )}
              </td>
              <td className="mono">
                {editingId === row.id ? (
                  <input
                    type="text"
                    list="company-sic-codes-list"
                    value={editingSicCodeInput}
                    onChange={(event) => setEditingSicCodeInput(event.target.value)}
                    className="inline-table-input"
                    placeholder="Optional"
                  />
                ) : (
                  row.sicCode ?? ""
                )}
              </td>
              <td>{editingId === row.id ? "" : row.sicDescription ?? ""}</td>
              <td>{formatDateTime(row.updatedAt)}</td>
              <td>
                {editingId === row.id ? (
                  <div className="row-actions">
                    <button className="details-button" type="button" disabled={submitting} onClick={() => void saveEdit(row.id)}>
                      Save
                    </button>
                    <button
                      className="secondary-action"
                      type="button"
                      disabled={submitting}
                      onClick={() => {
                        setEditingId(null);
                        setEditingName("");
                        setEditingSicCodeInput("");
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    className="details-button"
                    type="button"
                    onClick={() => {
                      setEditingId(row.id);
                      setEditingName(row.name);
                      setEditingSicCodeInput(row.sicCode && row.sicDescription
                        ? buildSicOptionLabel({ code: row.sicCode, description: row.sicDescription })
                        : row.sicCode ?? "");
                    }}
                  >
                    Edit
                  </button>
                )}
              </td>
            </tr>
          )}
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Official Reference</p>
            <h3>Companies House SIC Codes</h3>
          </div>
        </div>
        <div className="search-form">
          <div className="table-search-group">
            <div className="table-search">
              <label htmlFor="sic-code-search">Search SIC codes</label>
              <input
                id="sic-code-search"
                type="search"
                value={sicSearchText}
                onChange={(event) => setSicSearchText(event.target.value)}
                placeholder="Search code or description"
              />
            </div>
          </div>
        </div>
        <p className="helper-copy">This is the full Companies House SIC condensed list.</p>
        <DataTable
          state={sicCodeState}
          emptyMessage="No Companies House SIC codes loaded."
          columns={["SIC code", "Description"]}
          renderRow={(row) => (
            <tr key={row.code}>
              <td className="mono">{row.code}</td>
              <td>{row.description}</td>
            </tr>
          )}
        />
      </section>
    </div>
  );
}

function CustomerValueTypesView({
  state,
  form,
  onFormChange,
  onDataChanged
}: {
  state: LoadState<CustomerValueType[]>;
  form: CustomerValueTypeFormState;
  onFormChange: Dispatch<SetStateAction<CustomerValueTypeFormState>>;
  onDataChanged: () => void;
}) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<ArchiveNotice | null>(null);

  async function saveEdit(customerValueTypeId: number) {
    setSaving(true);
    setNotice(null);

    try {
      const response = await fetchWithActor(`${apiBase}/api/customer-value-types/${customerValueTypeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: form.label || null,
          decimalValue: form.decimalValue ? Number(form.decimalValue) : null
        })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? `HTTP ${response.status}`);
      }

      setEditingId(null);
      onFormChange({ label: "", decimalValue: "" });
      setNotice({ kind: "success", message: "Customer value type updated." });
      onDataChanged();
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not update customer value type."
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="test-page">
      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Customer Value Type</p>
            <h3>Shield Maintenance</h3>
          </div>
        </div>
        <p className="helper-copy">The five shield references are fixed. You can change the label and decimal value for each one. A customer value of 0 means unassigned.</p>
        {notice && <StatusBanner kind={notice.kind} message={notice.message} />}
        <DataTable
          state={state}
          emptyMessage="No customer value shields loaded."
          columns={["Shield", "Label", "Decimal value", "Updated", "Action"]}
          renderRow={(row) => (
            <tr key={row.id}>
              <td>
                <div className="customer-value-type-cell">
                  <img
                    className="customer-value-type-image"
                    src={getCustomerValueTypeImagePath(row.imageFileName)}
                    alt={row.label ? `Shield ${row.shieldOrder} ${row.label}` : `Shield ${row.shieldOrder}`}
                  />
                  <div className="customer-value-type-meta">
                    <strong>{`Shield ${row.shieldOrder}`}</strong>
                    <span className="muted mono">{row.shieldKey}</span>
                  </div>
                </div>
              </td>
              <td>
                {editingId === row.id ? (
                  <input
                    type="text"
                    value={form.label}
                    onChange={(event) => onFormChange((current) => ({ ...current, label: event.target.value }))}
                    className="inline-table-input"
                    placeholder="Label"
                  />
                ) : (
                  row.label ?? ""
                )}
              </td>
              <td>
                {editingId === row.id ? (
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.decimalValue}
                    onChange={(event) => onFormChange((current) => ({ ...current, decimalValue: event.target.value }))}
                    className="inline-table-input"
                    placeholder="0.00"
                  />
                ) : (
                  row.decimalValue?.toString() ?? ""
                )}
              </td>
              <td>{formatDateTime(row.updatedAt)}</td>
              <td>
                {editingId === row.id ? (
                  <div className="row-actions">
                    <button className="details-button" type="button" disabled={saving} onClick={() => void saveEdit(row.id)}>
                      Save
                    </button>
                    <button
                      className="secondary-action"
                      type="button"
                      disabled={saving}
                      onClick={() => {
                        setEditingId(null);
                        onFormChange({ label: "", decimalValue: "" });
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    className="details-button"
                    type="button"
                    onClick={() => {
                      setEditingId(row.id);
                      onFormChange({
                        label: row.label ?? "",
                        decimalValue: row.decimalValue?.toString() ?? ""
                      });
                    }}
                  >
                    Edit
                  </button>
                )}
              </td>
            </tr>
          )}
        />
      </section>
    </div>
  );
}

function CustomerActivityStatusesView({
  state,
  form,
  onFormChange,
  onDataChanged
}: {
  state: LoadState<CustomerActivityStatusOption[]>;
  form: CustomerActivityStatusFormState;
  onFormChange: Dispatch<SetStateAction<CustomerActivityStatusFormState>>;
  onDataChanged: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingSortOrder, setEditingSortOrder] = useState("");
  const [notice, setNotice] = useState<ArchiveNotice | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setNotice(null);

    try {
      const response = await fetchWithActor(`${apiBase}/api/customer-activity-statuses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          sortOrder: form.sortOrder.trim() ? Number(form.sortOrder) : null
        })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? `HTTP ${response.status}`);
      }

      onFormChange({ name: "", sortOrder: "" });
      setNotice({ kind: "success", message: "Customer activity status added." });
      onDataChanged();
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not add customer activity status."
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function saveEdit(statusId: number) {
    setSubmitting(true);
    setNotice(null);

    try {
      const response = await fetchWithActor(`${apiBase}/api/customer-activity-statuses/${statusId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editingName,
          sortOrder: editingSortOrder.trim() ? Number(editingSortOrder) : null
        })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? `HTTP ${response.status}`);
      }

      setEditingId(null);
      setEditingName("");
      setEditingSortOrder("");
      setNotice({ kind: "success", message: "Customer activity status updated." });
      onDataChanged();
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not update customer activity status."
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="test-page">
      <form className="search-form" onSubmit={(event) => void submit(event)}>
        <div className="table-search-group">
          <div className="table-search">
            <label htmlFor="customer-activity-status-name">Customer activity status</label>
            <input
              id="customer-activity-status-name"
              type="text"
              value={form.name}
              onChange={(event) => onFormChange((current) => ({ ...current, name: event.target.value }))}
              placeholder="Active"
            />
          </div>
          <div className="table-search table-search-compact">
            <label htmlFor="customer-activity-status-sort-order">Sort order</label>
            <input
              id="customer-activity-status-sort-order"
              type="number"
              value={form.sortOrder}
              onChange={(event) => onFormChange((current) => ({ ...current, sortOrder: event.target.value }))}
              placeholder="10"
            />
          </div>
        </div>
        <div className="page-actions">
          <button className="page-action-button" type="submit" disabled={submitting}>
            {submitting ? "Saving..." : "Add customer activity status"}
          </button>
        </div>
      </form>
      {notice && <StatusBanner kind={notice.kind} message={notice.message} />}
      <DataTable
        state={state}
        emptyMessage="No customer activity statuses added yet."
        columns={["Created", "Customer activity status", "Sort", "Updated", "Action"]}
        renderRow={(row) => (
          <tr key={row.id}>
            <td>{formatDateTime(row.createdAt)}</td>
            <td>
              {editingId === row.id ? (
                <input
                  type="text"
                  value={editingName}
                  onChange={(event) => setEditingName(event.target.value)}
                  className="inline-table-input"
                />
              ) : (
                row.name
              )}
            </td>
            <td>
              {editingId === row.id ? (
                <input
                  type="number"
                  value={editingSortOrder}
                  onChange={(event) => setEditingSortOrder(event.target.value)}
                  className="inline-table-input inline-table-input-small"
                />
              ) : (
                row.sortOrder
              )}
            </td>
            <td>{formatDateTime(row.updatedAt)}</td>
            <td>
              {editingId === row.id ? (
                <div className="row-actions">
                  <button className="details-button" type="button" disabled={submitting} onClick={() => void saveEdit(row.id)}>
                    Save
                  </button>
                  <button
                    className="secondary-action"
                    type="button"
                    disabled={submitting}
                    onClick={() => {
                      setEditingId(null);
                      setEditingName("");
                      setEditingSortOrder("");
                    }}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  className="details-button"
                  type="button"
                  onClick={() => {
                    setEditingId(row.id);
                    setEditingName(row.name);
                    setEditingSortOrder(String(row.sortOrder));
                  }}
                >
                  Edit
                </button>
              )}
            </td>
          </tr>
        )}
      />
    </div>
  );
}

function LeadStatusesView({
  state,
  form,
  onFormChange,
  onDataChanged
}: {
  state: LoadState<LeadStatusOption[]>;
  form: LeadStatusFormState;
  onFormChange: Dispatch<SetStateAction<LeadStatusFormState>>;
  onDataChanged: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingSortOrder, setEditingSortOrder] = useState("");
  const [notice, setNotice] = useState<ArchiveNotice | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setNotice(null);

    try {
      const response = await fetchWithActor(`${apiBase}/api/lead-statuses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          sortOrder: form.sortOrder.trim() ? Number(form.sortOrder) : null
        })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? `HTTP ${response.status}`);
      }

      onFormChange({ name: "", sortOrder: "" });
      setNotice({ kind: "success", message: "Lead status added." });
      onDataChanged();
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not add lead status."
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function saveEdit(leadStatusId: number) {
    setSubmitting(true);
    setNotice(null);

    try {
      const response = await fetchWithActor(`${apiBase}/api/lead-statuses/${leadStatusId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editingName,
          sortOrder: editingSortOrder.trim() ? Number(editingSortOrder) : null
        })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? `HTTP ${response.status}`);
      }

      setEditingId(null);
      setEditingName("");
      setEditingSortOrder("");
      setNotice({ kind: "success", message: "Lead status updated." });
      onDataChanged();
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not update lead status."
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="test-page">
      <form className="search-form" onSubmit={(event) => void submit(event)}>
        <div className="table-search-group">
          <div className="table-search">
            <label htmlFor="lead-status-name">Lead status name</label>
            <input
              id="lead-status-name"
              type="text"
              value={form.name}
              onChange={(event) => onFormChange((current) => ({ ...current, name: event.target.value }))}
              placeholder="open"
            />
          </div>
          <div className="table-search table-search-compact">
            <label htmlFor="lead-status-sort-order">Sort order</label>
            <input
              id="lead-status-sort-order"
              type="number"
              value={form.sortOrder}
              onChange={(event) => onFormChange((current) => ({ ...current, sortOrder: event.target.value }))}
              placeholder="20"
            />
          </div>
        </div>
        <div className="page-actions">
          <button className="page-action-button" type="submit" disabled={submitting}>
            {submitting ? "Saving..." : "Add lead status"}
          </button>
        </div>
      </form>
      {notice && <StatusBanner kind={notice.kind} message={notice.message} />}
      <DataTable
        state={state}
        emptyMessage="No lead statuses added yet."
        columns={["Created", "Lead status", "Sort", "Updated", "Action"]}
        renderRow={(row) => (
          <tr key={row.id}>
            <td>{formatDateTime(row.createdAt)}</td>
            <td>
              {editingId === row.id ? (
                <input
                  type="text"
                  value={editingName}
                  onChange={(event) => setEditingName(event.target.value)}
                  className="inline-table-input"
                />
              ) : (
                row.name
              )}
            </td>
            <td>
              {editingId === row.id ? (
                <input
                  type="number"
                  value={editingSortOrder}
                  onChange={(event) => setEditingSortOrder(event.target.value)}
                  className="inline-table-input inline-table-input-small"
                />
              ) : (
                row.sortOrder
              )}
            </td>
            <td>{formatDateTime(row.updatedAt)}</td>
            <td>
              {editingId === row.id ? (
                <div className="row-actions">
                  <button className="details-button" type="button" disabled={submitting} onClick={() => void saveEdit(row.id)}>
                    Save
                  </button>
                  <button
                    className="secondary-action"
                    type="button"
                    disabled={submitting}
                    onClick={() => {
                      setEditingId(null);
                      setEditingName("");
                      setEditingSortOrder("");
                    }}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  className="details-button"
                  type="button"
                  onClick={() => {
                    setEditingId(row.id);
                    setEditingName(row.name);
                    setEditingSortOrder(String(row.sortOrder));
                  }}
                >
                  Edit
                </button>
              )}
            </td>
          </tr>
        )}
      />
    </div>
  );
}

function CampaignsView({
  state,
  form,
  onFormChange,
  leadStatuses,
  onDataChanged
}: {
  state: LoadState<Campaign[]>;
  form: CampaignFormState;
  onFormChange: Dispatch<SetStateAction<CampaignFormState>>;
  leadStatuses: LeadStatusOption[];
  onDataChanged: () => void;
}) {
  const [mode, setMode] = useState<"list" | "add">("list");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<ArchiveNotice | null>(null);
  const [waveForms, setWaveForms] = useState<Record<number, CampaignWaveFormState>>({});
  const [selectedWaveId, setSelectedWaveId] = useState<number | null>(null);
  const [waveLeadsState, setWaveLeadsState] = useState<LoadState<Lead[]>>({ loading: false });
  const [waveLeadSearchText, setWaveLeadSearchText] = useState("");
  const [waveLeadPriorityFilter, setWaveLeadPriorityFilter] = useState("all");
  const [waveLeadSortKey, setWaveLeadSortKey] = useState<"id" | "customerName" | "tradingName" | "postcode" | "leadPriority" | "leadStatus">("id");
  const [waveLeadSortDirection, setWaveLeadSortDirection] = useState<SortDirection>("asc");

  function handleWaveLeadSort(nextKey: typeof waveLeadSortKey) {
    if (waveLeadSortKey === nextKey) {
      setWaveLeadSortDirection((current) => current === "asc" ? "desc" : "asc");
      return;
    }

    setWaveLeadSortKey(nextKey);
    setWaveLeadSortDirection("asc");
  }

  async function submitCampaign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setNotice(null);

    try {
      const response = await fetchWithActor(`${apiBase}/api/campaigns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? `HTTP ${response.status}`);
      }

      onFormChange({
        name: "",
        description: "",
        objective: "",
        startDate: "",
        endDate: "",
        targetAudience: "",
        budget: "",
        productService: "",
        status: "Draft"
      });
      setNotice({ kind: "success", message: "Campaign created." });
      onDataChanged();
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not create campaign."
      });
    } finally {
      setSubmitting(false);
    }
  }

  function getWaveForm(campaign: Campaign): CampaignWaveFormState {
    return waveForms[campaign.id] ?? {
      name: "",
      waveNumber: String((campaign.waves.at(-1)?.waveNumber ?? 0) + 1),
      channel: "Mixed",
      scheduledDate: "",
      status: "Planned",
      assignedTeamOrUser: ""
    };
  }

  async function submitWave(campaignId: number, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const waveForm = getWaveForm(state.data?.find((campaign) => campaign.id === campaignId) ?? {
      id: campaignId,
      name: "",
      status: "Draft",
      createdAt: "",
      waves: []
    } as Campaign);
    setNotice(null);

    try {
      const response = await fetchWithActor(`${apiBase}/api/campaigns/${campaignId}/waves`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...waveForm,
          waveNumber: Number(waveForm.waveNumber)
        })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? `HTTP ${response.status}`);
      }

      setWaveForms((current) => ({
        ...current,
        [campaignId]: {
          name: "",
          waveNumber: "",
          channel: "Mixed",
          scheduledDate: "",
          status: "Planned",
          assignedTeamOrUser: ""
        }
      }));
      setNotice({ kind: "success", message: "Wave added." });
      onDataChanged();
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not add wave."
      });
    }
  }

  async function toggleWaveLeads(waveId: number) {
    if (selectedWaveId === waveId && waveLeadsState.data) {
      setSelectedWaveId(null);
      setWaveLeadsState({ loading: false });
      return;
    }

    setWaveLeadSearchText("");
    setWaveLeadPriorityFilter("all");
    setWaveLeadSortKey("id");
    setWaveLeadSortDirection("asc");
    setSelectedWaveId(waveId);
    await loadWaveLeads(waveId);
  }

  async function loadWaveLeads(waveId: number) {
    setWaveLeadsState({ loading: true });

    try {
      const response = await fetchWithActor(`${apiBase}/api/campaign-waves/${waveId}/leads`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as Lead[];
      setWaveLeadsState({ data, loading: false });
    } catch (error) {
      setWaveLeadsState({
        error: error instanceof Error ? error.message : "Could not load wave leads.",
        loading: false
      });
    }
  }

  function downloadWaveCsv(waveId: number) {
    const link = document.createElement("a");
    link.href = `${apiBase}/api/campaign-waves/${waveId}/export`;
    link.download = `campaign-wave-${waveId}-leads.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  async function updateWaveLeadStatus(waveId: number, leadId: number, leadStatus: string) {
    setNotice(null);
    try {
      const response = await fetchWithActor(`${apiBase}/api/leads/${leadId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadStatus })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? `HTTP ${response.status}`);
      }
      await loadWaveLeads(waveId);
      onDataChanged();
      setNotice({ kind: "success", message: "Lead status updated." });
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not update lead status."
      });
    }
  }

  async function updateWaveLeadPriority(waveId: number, leadId: number, leadPriority: LeadPriority) {
    setNotice(null);
    try {
      const response = await fetchWithActor(`${apiBase}/api/leads/${leadId}/priority`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadPriority })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? `HTTP ${response.status}`);
      }
      await loadWaveLeads(waveId);
      onDataChanged();
      setNotice({ kind: "success", message: "Lead priority updated." });
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not update lead priority."
      });
    }
  }

  async function removeLeadFromWave(waveId: number, leadId: number) {
    setNotice(null);
    try {
      const response = await fetchWithActor(`${apiBase}/api/campaign-waves/${waveId}/leads/${leadId}`, {
        method: "DELETE"
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? `HTTP ${response.status}`);
      }
      setWaveLeadsState((current) => ({
        ...current,
        data: current.data?.filter((lead) => lead.id !== leadId)
      }));
      onDataChanged();
      setNotice({ kind: "success", message: "Lead removed from wave." });
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not remove lead from wave."
      });
    }
  }

  const filteredWaveLeads = waveLeadsState.data
    ?.filter((lead) => {
      if (waveLeadPriorityFilter !== "all" && lead.leadPriority !== waveLeadPriorityFilter) {
        return false;
      }

      const query = waveLeadSearchText.trim().toLowerCase();
      if (!query) return true;

      return [
        `Lead ${lead.id}`,
        lead.customerName,
        lead.tradingName,
        lead.contactEmail,
        lead.postcode,
        lead.leadStatus
      ]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(query));
    })
    .sort((left, right) =>
      compareValues(
        getWaveLeadSortValue(left, waveLeadSortKey),
        getWaveLeadSortValue(right, waveLeadSortKey),
        waveLeadSortDirection
      )
    );

  return (
    <div className="test-page">
      <section className="table-controls">
        <div className="table-filter-actions">
          <button
            className={mode === "list" ? "page-action-button" : "secondary-action"}
            type="button"
            onClick={() => setMode("list")}
          >
            List
          </button>
          <button
            className={mode === "add" ? "page-action-button" : "secondary-action"}
            type="button"
            onClick={() => setMode("add")}
          >
            Add Campaigns & Waves
          </button>
        </div>
      </section>
      {mode === "add" && (
        <form className="search-form" onSubmit={(event) => void submitCampaign(event)}>
          <label htmlFor="campaign-name">Name</label>
          <input id="campaign-name" type="text" value={form.name} onChange={(event) => onFormChange((current) => ({ ...current, name: event.target.value }))} />
          <label htmlFor="campaign-description">Description</label>
          <input id="campaign-description" type="text" value={form.description} onChange={(event) => onFormChange((current) => ({ ...current, description: event.target.value }))} />
          <label htmlFor="campaign-objective">Objective</label>
          <input id="campaign-objective" type="text" value={form.objective} onChange={(event) => onFormChange((current) => ({ ...current, objective: event.target.value }))} />
          <div className="table-search-group">
            <div className="table-search">
              <label htmlFor="campaign-start-date">Start date</label>
              <input id="campaign-start-date" type="date" value={form.startDate} onChange={(event) => onFormChange((current) => ({ ...current, startDate: event.target.value }))} />
            </div>
            <div className="table-search">
              <label htmlFor="campaign-end-date">End date</label>
              <input id="campaign-end-date" type="date" value={form.endDate} onChange={(event) => onFormChange((current) => ({ ...current, endDate: event.target.value }))} />
            </div>
          </div>
          <label htmlFor="campaign-target-audience">Target audience</label>
          <input id="campaign-target-audience" type="text" value={form.targetAudience} onChange={(event) => onFormChange((current) => ({ ...current, targetAudience: event.target.value }))} />
          <div className="table-search-group">
            <div className="table-search">
              <label htmlFor="campaign-budget">Budget</label>
              <input id="campaign-budget" type="number" step="0.01" value={form.budget} onChange={(event) => onFormChange((current) => ({ ...current, budget: event.target.value }))} />
            </div>
            <div className="table-search">
              <label htmlFor="campaign-product-service">Product or service</label>
              <input id="campaign-product-service" type="text" value={form.productService} onChange={(event) => onFormChange((current) => ({ ...current, productService: event.target.value }))} />
            </div>
            <div className="table-search">
              <label htmlFor="campaign-status">Status</label>
              <select id="campaign-status" className="header-select" value={form.status} onChange={(event) => onFormChange((current) => ({ ...current, status: event.target.value }))}>
                <option value="Draft">Draft</option>
                <option value="Active">Active</option>
                <option value="Paused">Paused</option>
                <option value="Completed">Completed</option>
              </select>
            </div>
          </div>
          <div className="page-actions">
            <button className="page-action-button" type="submit" disabled={submitting}>
              {submitting ? "Saving..." : "Create campaign"}
            </button>
          </div>
        </form>
      )}
      {notice && <StatusBanner kind={notice.kind} message={notice.message} />}
      {state.loading && <PanelSkeleton />}
      {state.error && <ErrorPanel error={state.error} />}
      {!state.loading && !state.error && !state.data?.length && <EmptyPanel message="No campaigns yet." />}
      {state.data?.map((campaign) => {
        const waveForm = getWaveForm(campaign);
        return (
          <section className="detail-panel" key={campaign.id}>
            <div className="detail-header">
              <div>
                <span className="eyebrow">Campaign</span>
                <h3>{campaign.name}</h3>
                <p>{campaign.objective ?? campaign.description ?? ""}</p>
              </div>
              <div className="panel-actions">
                <Badge text={campaign.status} />
              </div>
            </div>
            <div className={mode === "list" ? "detail-grid campaign-list-grid" : "detail-grid"}>
              <article className="detail-card">
                <h4>Overview</h4>
                <dl className="detail-list">
                  <div><dt>Target audience</dt><dd>{campaign.targetAudience ?? ""}</dd></div>
                  <div><dt>Product/service</dt><dd>{campaign.productService ?? ""}</dd></div>
                  <div><dt>Budget</dt><dd>{campaign.budget ?? ""}</dd></div>
                  <div><dt>Dates</dt><dd>{formatDate(campaign.startDate)} to {formatDate(campaign.endDate)}</dd></div>
                </dl>
              </article>
              <article className="detail-card">
                <h4>Waves</h4>
                {campaign.waves.length ? (
                  <table>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Name</th>
                        <th>Channel</th>
                        <th>Scheduled</th>
                        <th>Status</th>
                        <th>Assigned</th>
                      </tr>
                    </thead>
                    <tbody>
                      {campaign.waves.map((wave) => (
                        <Fragment key={wave.id}>
                          <tr>
                          <td>{wave.waveNumber}</td>
                          <td>
                            <button className="row-link" type="button" onClick={() => void toggleWaveLeads(wave.id)}>
                              {wave.name}
                            </button>
                          </td>
                          <td>{wave.channel}</td>
                          <td>{formatDate(wave.scheduledDate)}</td>
                          <td>{wave.status}</td>
                          <td>{wave.assignedTeamOrUser ?? ""}</td>
                          </tr>
                          {selectedWaveId === wave.id && (
                            <tr className="detail-table-row">
                              <td className="detail-table-cell" colSpan={6}>
                                {waveLeadsState.loading && <PanelSkeleton compact />}
                                {waveLeadsState.error && <ErrorPanel error={waveLeadsState.error} />}
                                {waveLeadsState.data && (
                                  waveLeadsState.data.length ? (
                                    <section className="wave-leads-panel">
                                      <div className="table-caption">
                                        <div>
                                          <strong>{filteredWaveLeads?.length ?? 0}</strong>
                                          <span> lead{(filteredWaveLeads?.length ?? 0) === 1 ? "" : "s"} in this wave</span>
                                        </div>
                                        <button className="secondary-action" type="button" onClick={() => downloadWaveCsv(wave.id)}>
                                          Export CSV
                                        </button>
                                      </div>
                                      <section className="table-controls">
                                        <div className="table-search">
                                          <label htmlFor={`wave-leads-search-${wave.id}`}>Search leads</label>
                                          <input
                                            id={`wave-leads-search-${wave.id}`}
                                            type="search"
                                            value={waveLeadSearchText}
                                            onChange={(event) => setWaveLeadSearchText(event.target.value)}
                                            placeholder="Customer, trading, email, postcode, status"
                                          />
                                        </div>
                                        <div className="table-search table-search-compact">
                                          <label htmlFor={`wave-leads-priority-${wave.id}`}>Priority</label>
                                          <select
                                            id={`wave-leads-priority-${wave.id}`}
                                            className="header-select"
                                            value={waveLeadPriorityFilter}
                                            onChange={(event) => setWaveLeadPriorityFilter(event.target.value)}
                                          >
                                            <option value="all">All priorities</option>
                                            {leadPriorityOrder.map((priority) => (
                                              <option key={priority} value={priority}>
                                                {getLeadPriorityLabel(priority)}
                                              </option>
                                            ))}
                                          </select>
                                        </div>
                                      </section>
                                      <table>
                                        <thead>
                                          <tr>
                                            <th>{renderSortHeader("Lead", waveLeadSortKey === "id", waveLeadSortDirection, () => handleWaveLeadSort("id"))}</th>
                                            <th>{renderSortHeader("Customer", waveLeadSortKey === "customerName", waveLeadSortDirection, () => handleWaveLeadSort("customerName"))}</th>
                                            <th>{renderSortHeader("Trading name", waveLeadSortKey === "tradingName", waveLeadSortDirection, () => handleWaveLeadSort("tradingName"))}</th>
                                            <th>Phone</th>
                                            <th>Email</th>
                                            <th>{renderSortHeader("Postcode", waveLeadSortKey === "postcode", waveLeadSortDirection, () => handleWaveLeadSort("postcode"))}</th>
                                            <th>{renderSortHeader("Priority", waveLeadSortKey === "leadPriority", waveLeadSortDirection, () => handleWaveLeadSort("leadPriority"))}</th>
                                            <th>{renderSortHeader("Status", waveLeadSortKey === "leadStatus", waveLeadSortDirection, () => handleWaveLeadSort("leadStatus"))}</th>
                                            <th>Action</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {filteredWaveLeads?.map((lead) => (
                                            <tr key={lead.id}>
                                              <td>
                                                <span className="mono">Lead #{lead.id}</span>
                                              </td>
                                              <td>
                                                <span className="stacked">{lead.customerName}</span>
                                              </td>
                                              <td>{lead.tradingName ?? ""}</td>
                                              <td>{lead.contactPhone ?? ""}</td>
                                              <td><CopyableEmail email={lead.contactEmail} /></td>
                                              <td className="mono">{lead.postcode ?? ""}</td>
                                              <td>
                                                <LeadPriorityLights
                                                  value={lead.leadPriority}
                                                  onChange={(priority) => void updateWaveLeadPriority(wave.id, lead.id, priority)}
                                                />
                                              </td>
                                              <td>
                                                <select
                                                  className="header-select"
                                                  value={lead.leadStatus}
                                                  onChange={(event) => void updateWaveLeadStatus(wave.id, lead.id, event.target.value)}
                                                >
                                                  {leadStatuses.map((status) => (
                                                    <option key={status.id} value={status.name}>
                                                      {status.name}
                                                    </option>
                                                  ))}
                                                </select>
                                              </td>
                                              <td>
                                                <button
                                                  className="secondary-action destructive-action"
                                                  type="button"
                                                  onClick={() => void removeLeadFromWave(wave.id, lead.id)}
                                                >
                                                  Remove
                                                </button>
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </section>
                                  ) : (
                                    <EmptyPanel message="No leads in this wave yet." />
                                  )
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="muted">No waves yet.</p>
                )}
                {mode === "add" && (
                  <form className="search-form" onSubmit={(event) => void submitWave(campaign.id, event)}>
                    <label htmlFor={`wave-name-${campaign.id}`}>Wave name</label>
                    <input
                      id={`wave-name-${campaign.id}`}
                      type="text"
                      value={waveForm.name}
                      onChange={(event) => setWaveForms((current) => ({ ...current, [campaign.id]: { ...waveForm, name: event.target.value } }))}
                    />
                    <div className="table-search-group">
                      <div className="table-search">
                        <label htmlFor={`wave-number-${campaign.id}`}>Wave number</label>
                        <input
                          id={`wave-number-${campaign.id}`}
                          type="number"
                          min="1"
                          value={waveForm.waveNumber}
                          onChange={(event) => setWaveForms((current) => ({ ...current, [campaign.id]: { ...waveForm, waveNumber: event.target.value } }))}
                        />
                      </div>
                      <div className="table-search">
                        <label htmlFor={`wave-channel-${campaign.id}`}>Channel</label>
                        <select
                          id={`wave-channel-${campaign.id}`}
                          className="header-select"
                          value={waveForm.channel}
                          onChange={(event) => setWaveForms((current) => ({ ...current, [campaign.id]: { ...waveForm, channel: event.target.value } }))}
                        >
                          <option value="Email">Email</option>
                          <option value="Leaflet">Leaflet</option>
                          <option value="Phone">Phone</option>
                          <option value="Direct visit">Direct visit</option>
                          <option value="Mixed">Mixed</option>
                        </select>
                      </div>
                      <div className="table-search">
                        <label htmlFor={`wave-date-${campaign.id}`}>Scheduled date</label>
                        <input
                          id={`wave-date-${campaign.id}`}
                          type="date"
                          value={waveForm.scheduledDate}
                          onChange={(event) => setWaveForms((current) => ({ ...current, [campaign.id]: { ...waveForm, scheduledDate: event.target.value } }))}
                        />
                      </div>
                    </div>
                    <div className="table-search-group">
                      <div className="table-search">
                        <label htmlFor={`wave-status-${campaign.id}`}>Status</label>
                        <select
                          id={`wave-status-${campaign.id}`}
                          className="header-select"
                          value={waveForm.status}
                          onChange={(event) => setWaveForms((current) => ({ ...current, [campaign.id]: { ...waveForm, status: event.target.value } }))}
                        >
                          <option value="Planned">Planned</option>
                          <option value="Ready">Ready</option>
                          <option value="In progress">In progress</option>
                          <option value="Completed">Completed</option>
                        </select>
                      </div>
                      <div className="table-search">
                        <label htmlFor={`wave-assigned-${campaign.id}`}>Assigned team/user</label>
                        <input
                          id={`wave-assigned-${campaign.id}`}
                          type="text"
                          value={waveForm.assignedTeamOrUser}
                          onChange={(event) => setWaveForms((current) => ({ ...current, [campaign.id]: { ...waveForm, assignedTeamOrUser: event.target.value } }))}
                        />
                      </div>
                    </div>
                    <div className="page-actions">
                      <button className="secondary-action" type="submit">Add wave</button>
                    </div>
                  </form>
                )}
              </article>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function DataTable<T>({
  state,
  emptyMessage,
  columns,
  renderRow,
  className
}: {
  state: LoadState<T[]>;
  emptyMessage: string;
  columns: ReactNode[];
  renderRow: (row: T) => ReactNode;
  className?: string;
}) {
  if (state.loading && !state.data) return <PanelSkeleton />;
  if (state.error && !state.data) return <ErrorPanel error={state.error} />;
  if (!state.data?.length) return <EmptyPanel message={emptyMessage} />;

  return (
    <section className={className ? `table-wrap ${className}` : "table-wrap"}>
      <table>
        <thead>
          <tr>
            {columns.map((column, index) => (
              <th key={typeof column === "string" ? column : `column-${index}`}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>{state.data.map(renderRow)}</tbody>
      </table>
    </section>
  );
}

function InlineProspectDetailRow({
  colspan,
  detailState,
  customerContext,
  usingCurrentProspect,
  onUseCurrentProspect
}: {
  colspan: number;
  detailState: LoadState<ProspectDetail>;
  customerContext?: ProspectTestCustomerContext | null;
  usingCurrentProspect?: boolean;
  onUseCurrentProspect?: () => void;
}) {
  return (
    <tr className="detail-table-row">
      <td className="detail-table-cell" colSpan={colspan}>
        {detailState.loading && <PanelSkeleton compact />}
        {detailState.error && <ErrorPanel error={detailState.error} />}
        {detailState.data && (
          <ProspectDetailPanel
            detail={detailState.data}
            inline
            customerContext={customerContext}
            usingCurrentProspect={usingCurrentProspect}
            onUseCurrentProspect={onUseCurrentProspect}
          />
        )}
      </td>
    </tr>
  );
}

function CustomerMatchDetailRow({
  colspan,
  state,
  customerId,
  customer,
  customerValueTypes,
  notesRefreshKey,
  onCustomerValueChanged,
  onOpenLead,
  onOpenAiCompanyInsight,
  onDataChanged,
  onMatchesChanged
}: {
  colspan: number;
  state: LoadState<CustomerMatchResult>;
  customerId: number;
  customer: Pick<Customer, "id" | "entityName" | "tradingName" | "postcode" | "hasAiInsightJobScheduled">;
  customerValueTypes: CustomerValueType[];
  notesRefreshKey?: number;
  onCustomerValueChanged: (customerId: number, next: Pick<Customer, "customerValueTypeId" | "customerValueTypeLabel" | "customerValueTypeDecimalValue" | "customerValueTypeShieldOrder" | "customerValueTypeImageFileName">) => void;
  onOpenLead: (leadId: number) => void;
  onOpenAiCompanyInsight: (customer: Pick<Customer, "id" | "entityName" | "tradingName" | "postcode" | "hasAiInsightJobScheduled">) => void;
  onDataChanged: () => void;
  onMatchesChanged: (next: CustomerMatchResult) => void;
}) {
  return (
    <tr className="detail-table-row">
      <td className="detail-table-cell" colSpan={colspan}>
        {state.loading && <PanelSkeleton compact />}
        {state.error && <ErrorPanel error={state.error} />}
        {state.data && (
          <CustomerMatchPanel
            result={state.data}
            customerId={customerId}
            customer={customer}
            customerValueTypes={customerValueTypes}
            notesRefreshKey={notesRefreshKey}
            onCustomerValueChanged={onCustomerValueChanged}
            onOpenLead={onOpenLead}
            onOpenAiCompanyInsight={onOpenAiCompanyInsight}
            onDataChanged={onDataChanged}
            onMatchesChanged={onMatchesChanged}
          />
        )}
      </td>
    </tr>
  );
}

function CustomerMatchPanel({
  result,
  customerId,
  customer,
  customerValueTypes,
  notesRefreshKey,
  onCustomerValueChanged,
  onOpenLead,
  onOpenAiCompanyInsight,
  onDataChanged,
  onMatchesChanged
}: {
  result: CustomerMatchResult;
  customerId: number;
  customer: Pick<Customer, "id" | "entityName" | "tradingName" | "postcode" | "hasAiInsightJobScheduled">;
  customerValueTypes: CustomerValueType[];
  notesRefreshKey?: number;
  onCustomerValueChanged: (customerId: number, next: Pick<Customer, "customerValueTypeId" | "customerValueTypeLabel" | "customerValueTypeDecimalValue" | "customerValueTypeShieldOrder" | "customerValueTypeImageFileName">) => void;
  onOpenLead: (leadId: number) => void;
  onOpenAiCompanyInsight: (customer: Pick<Customer, "id" | "entityName" | "tradingName" | "postcode" | "hasAiInsightJobScheduled">) => void;
  onDataChanged: () => void;
  onMatchesChanged: (next: CustomerMatchResult) => void;
}) {
  const [leadState, setLeadState] = useState<LoadState<LeadSummary>>({ data: result.lead, loading: false });
  const [notesState, setNotesState] = useState<LoadState<CustomerNote[]>>({ loading: false });
  const [removingMatchId, setRemovingMatchId] = useState<number | null>(null);
  const [suppressionReason, setSuppressionReason] = useState(result.suppressionReason ?? "");
  const [savingSuppression, setSavingSuppression] = useState(false);
  const [commercials, setCommercials] = useState<CustomerCommercials | undefined>(result.commercials);
  const [customerBusinessTypes, setCustomerBusinessTypes] = useState<CustomerBusinessType[]>(result.businessTypes ?? []);
  const [businessTypeFilter, setBusinessTypeFilter] = useState("");
  const [savingBusinessTypes, setSavingBusinessTypes] = useState(false);
  const [businessTypeModalOpen, setBusinessTypeModalOpen] = useState(false);
  const [businessTypeOptionsState, setBusinessTypeOptionsState] = useState<LoadState<CustomerBusinessTypeOption[]>>({ loading: false });
  const [removingAiInsight, setRemovingAiInsight] = useState(false);

  const filteredBusinessTypeOptions = useMemo(() => {
    const needle = normalizeMatchText(businessTypeFilter);
    const base = (businessTypeOptionsState.data ?? []).filter((option) => {
      if (!needle) return true;
      return [option.name, option.sicCode ?? "", option.description ?? ""]
        .map((value) => normalizeMatchText(value))
        .some((value) => value.includes(needle));
    });

    return base.slice(0, businessTypeFilter.trim() ? 30 : 12);
  }, [businessTypeFilter, businessTypeOptionsState.data]);
  const selectedBusinessTypeKeys = useMemo(
    () => new Set(customerBusinessTypes.map((row) => row.key)),
    [customerBusinessTypes]
  );

  useEffect(() => {
    setLeadState({ data: result.lead, loading: false });
  }, [result.lead]);

  useEffect(() => {
    setSuppressionReason(result.suppressionReason ?? "");
  }, [result.suppressionReason]);

  useEffect(() => {
    setCommercials(result.commercials);
  }, [result.commercials]);

  useEffect(() => {
    setCustomerBusinessTypes(result.businessTypes ?? []);
  }, [result.businessTypes]);

  useEffect(() => {
    let cancelled = false;

    async function loadBusinessTypeOptions() {
      if (!businessTypeModalOpen || businessTypeOptionsState.data || businessTypeOptionsState.loading) {
        return;
      }

      setBusinessTypeOptionsState({ loading: true });
      try {
        const response = await fetchWithActor(`${apiBase}/api/customer-business-type-options`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = (await response.json()) as CustomerBusinessTypeOption[];
        if (!cancelled) {
          setBusinessTypeOptionsState({ data, loading: false });
        }
      } catch (error) {
        if (!cancelled) {
          setBusinessTypeOptionsState({
            error: error instanceof Error ? error.message : "Could not load business type options.",
            loading: false
          });
        }
      }
    }

    void loadBusinessTypeOptions();
    return () => {
      cancelled = true;
    };
  }, [businessTypeModalOpen, businessTypeOptionsState.data]);

  useEffect(() => {
    let cancelled = false;

    async function loadNotes() {
      setNotesState({ loading: true });
      try {
        const response = await fetchWithActor(`${apiBase}/api/customers/${customerId}/notes`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const notes = (await response.json()) as CustomerNote[];
        if (!cancelled) {
          setNotesState({ data: notes, loading: false });
        }
      } catch (error) {
        if (!cancelled) {
          setNotesState({
            error: error instanceof Error ? error.message : "Could not load customer notes.",
            loading: false
          });
        }
      }
    }

    void loadNotes();

    return () => {
      cancelled = true;
    };
  }, [customerId, notesRefreshKey]);

  async function createLead() {
    setLeadState((current) => ({ ...current, loading: true, error: undefined }));

    try {
      const response = await fetchWithActor(`${apiBase}/api/customers/${customerId}/lead`, { method: "POST" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as LeadSummary;
      setLeadState({ data, loading: false });
      onDataChanged();
    } catch (error) {
      setLeadState({
        loading: false,
        error: error instanceof Error ? error.message : "Could not create lead."
      });
    }
  }

  async function removeMatch(matchId: number) {
    setRemovingMatchId(matchId);

    try {
      const response = await fetchWithActor(`${apiBase}/api/customers/${customerId}/matches/${matchId}`, { method: "DELETE" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      onMatchesChanged({
        ...result,
        matches: result.matches.filter((match) => match.matchId !== matchId)
      });
      onDataChanged();
    } finally {
      setRemovingMatchId(null);
    }
  }

  async function updateSuppression(nextValue: string) {
    setSavingSuppression(true);
    setSuppressionReason(nextValue);

    try {
      const response = await fetchWithActor(`${apiBase}/api/customers/${customerId}/suppression`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suppressionReason: nextValue || null })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      onDataChanged();
    } finally {
      setSavingSuppression(false);
    }
  }

  async function updateCustomerBusinessTypes(nextKeys: string[]) {
    setSavingBusinessTypes(true);

    try {
      const response = await fetchWithActor(`${apiBase}/api/customers/${customerId}/business-types`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys: nextKeys })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const next = (await response.json()) as CustomerBusinessType[];
      setCustomerBusinessTypes(next);
      onMatchesChanged({
        ...result,
        businessTypes: next
      });
      onDataChanged();
    } finally {
      setSavingBusinessTypes(false);
    }
  }

  function toggleBusinessType(option: CustomerBusinessTypeOption) {
    const nextKeys = selectedBusinessTypeKeys.has(option.key)
      ? customerBusinessTypes.filter((row) => row.key !== option.key).map((row) => row.key)
      : [...customerBusinessTypes.map((row) => row.key), option.key];
    void updateCustomerBusinessTypes(nextKeys);
  }

  async function removeCustomerAiInsight() {
    setRemovingAiInsight(true);

    try {
      const response = await fetchWithActor(`${apiBase}/api/customers/${customerId}/ai-company-insight`, {
        method: "DELETE"
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      onMatchesChanged({
        ...result,
        aiInsight: undefined
      });
      onDataChanged();
    } finally {
      setRemovingAiInsight(false);
    }
  }

  const businessTypeManager = (
    <div className="table-search">
      <label>Business types</label>
      {customerBusinessTypes.length ? (
        <div className="selection-chip-list">
          {customerBusinessTypes.map((businessType) => (
            <span key={businessType.key} className="selection-chip">
              <span>{businessType.name}</span>
              {businessType.sicCode ? <span className="muted">({businessType.sicCode})</span> : null}
            </span>
          ))}
        </div>
      ) : (
        <p className="muted">No business types selected.</p>
      )}
      <div className="page-actions">
        <button className="secondary-action" type="button" disabled={savingBusinessTypes} onClick={() => setBusinessTypeModalOpen(true)}>
          {customerBusinessTypes.length ? "Manage business types" : "Add business types"}
        </button>
      </div>
    </div>
  );

  const businessTypeModal = businessTypeModalOpen ? (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-panel modal-panel-wide" aria-modal="true" aria-labelledby={`customer-business-types-title-${customerId}`} role="dialog">
        <div className="modal-header">
          <div>
            <p className="eyebrow">Customer Details</p>
            <h3 id={`customer-business-types-title-${customerId}`}>Business Types</h3>
          </div>
          <button className="modal-close" type="button" onClick={() => setBusinessTypeModalOpen(false)}>
            Close
          </button>
        </div>
        <div className="modal-body modal-scroll">
          <div className="table-search modal-table-search">
            <label htmlFor={`customer-business-types-filter-${customerId}`}>Filter business types</label>
            <input
              id={`customer-business-types-filter-${customerId}`}
              type="search"
              value={businessTypeFilter}
              onChange={(event) => setBusinessTypeFilter(event.target.value)}
              placeholder="Search business type or SIC"
            />
          </div>
          {customerBusinessTypes.length ? (
            <div className="selection-chip-list">
              {customerBusinessTypes.map((businessType) => (
                <button
                  key={businessType.key}
                  className="selection-chip"
                  type="button"
                  disabled={savingBusinessTypes}
                  onClick={() =>
                    void updateCustomerBusinessTypes(customerBusinessTypes.filter((row) => row.key !== businessType.key).map((row) => row.key))
                  }
                >
                  <span>{businessType.name}</span>
                  <span aria-hidden>x</span>
                </button>
              ))}
            </div>
          ) : null}
          {businessTypeOptionsState.loading && <PanelSkeleton compact />}
          {businessTypeOptionsState.error && <ErrorPanel error={businessTypeOptionsState.error} />}
          {!businessTypeOptionsState.loading && !businessTypeOptionsState.error && (
            <div className="selection-option-list">
              {filteredBusinessTypeOptions.map((option) => (
                <label key={option.key} className="selection-option-row">
                  <input
                    type="checkbox"
                    checked={selectedBusinessTypeKeys.has(option.key)}
                    disabled={savingBusinessTypes}
                    onChange={() => toggleBusinessType(option)}
                  />
                  <span>
                    <strong>{option.name}</strong>
                    {option.sicCode ? <span className="muted"> ({option.sicCode})</span> : null}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  ) : null;

  const customerDetailsHeader = (
    <div className="detail-card-title-row">
      <h4>Customer details</h4>
      <div className="row-action-menu-inline-actions">
        <button className="secondary-action" type="button" onClick={() => onOpenAiCompanyInsight(customer)}>
          AI Customer Insight
        </button>
        {!result.aiInsight && customer.hasAiInsightJobScheduled ? (
          <span className="scheduled-insight-badge">Insight Scheduled</span>
        ) : null}
      </div>
    </div>
  );
  const hasCompaniesHouseData = hasCompaniesHouseIdentification(result.aiInsight?.companyNumber);

  const aiInsightPanel = result.aiInsight ? (
    <article className="detail-card detail-card-span-full">
      <div className="detail-header detail-header-inline">
        <div>
          <span className="eyebrow">AI Company Insight</span>
          <h4>{result.aiInsight.companyName}</h4>
        </div>
        <div className="panel-actions">
          <Badge text={`Saved ${formatDateTime(result.aiInsight.updatedAt)}`} />
          <button className="secondary-action destructive-action" type="button" disabled={removingAiInsight} onClick={() => void removeCustomerAiInsight()}>
            {removingAiInsight ? "Removing..." : "Remove from Customer"}
          </button>
        </div>
      </div>
      <section className="ai-insight-summary-grid ai-insight-summary-grid-inline">
        <article className="detail-card">
          <p className="eyebrow">Official Identification</p>
          <h3>{result.aiInsight.companyName}</h3>
          {hasCompaniesHouseData ? (
            <div className="ai-insight-inline-meta"><Hash size={14} aria-hidden /> {result.aiInsight.companyNumber}</div>
          ) : (
            <p className="ai-insight-helper-copy">
              No Companies House record was identified for this result. The business may not be a limited company, and this insight may be based on other public sources.
            </p>
          )}
        </article>
        <article className="detail-card">
          <p className="eyebrow">Live Status</p>
          <Badge text={result.aiInsight.status || "Unknown"} />
          <div className="ai-insight-stack">
            {hasCompaniesHouseData ? (
              <span><Calendar size={12} aria-hidden /> Inc: {result.aiInsight.incorporationDate || ""}</span>
            ) : (
              <span className="muted">No Companies House incorporation data was identified.</span>
            )}
            {result.aiInsight.turnover ? (
              <span><Hash size={12} aria-hidden /> Turnover: {result.aiInsight.turnover}</span>
            ) : null}
            {result.aiInsight.employeeCount ? (
              <span><Users size={12} aria-hidden /> Employees: {result.aiInsight.employeeCount}</span>
            ) : null}
            <span><Info size={12} aria-hidden /> {result.aiInsight.natureOfBusiness || ""}</span>
          </div>
        </article>
        <article className="detail-card">
          <p className="eyebrow">Contact Info</p>
          <div className="ai-insight-stack">
            {hasCompaniesHouseData && result.aiInsight.registeredAddress ? (
              <span><MapPin size={14} aria-hidden /> {result.aiInsight.registeredAddress}</span>
            ) : (
              <span className="muted">No registered Companies House address was identified for this result.</span>
            )}
            {result.aiInsight.website ? (
              <a className="row-link" href={result.aiInsight.website} target="_blank" rel="noreferrer">
                <Globe size={14} aria-hidden /> Main Website <ExternalLink size={12} aria-hidden />
              </a>
            ) : null}
            {(result.aiInsight.digitalLinks ?? []).slice(0, 3).map((link) => (
              <a key={link.url} className="row-link" href={link.url} target="_blank" rel="noreferrer">
                <ExternalLink size={12} aria-hidden /> {link.label}
              </a>
            ))}
          </div>
        </article>
      </section>
    </article>
  ) : null;

  if (!result.matches.length) {
    return (
      <section className="detail-panel inline">
        <div className="detail-header">
          <div>
            <span className="eyebrow">Potential Matches</span>
            <h3>No close prospect matches</h3>
          </div>
          <Badge text={result.generatedNow ? "Checked now" : "Stored result"} />
        </div>
        <div className="detail-grid customer-match-detail-grid">
          {aiInsightPanel}
          <article className="detail-card">
            {customerDetailsHeader}
            {businessTypeManager}
            <div className="table-search">
              <label htmlFor={`customer-suppression-${customerId}`}>Suppression reason</label>
              <select
                id={`customer-suppression-${customerId}`}
                className="header-select"
                value={suppressionReason}
                disabled={savingSuppression}
                onChange={(event) => void updateSuppression(event.target.value)}
              >
                <option value="">None</option>
                <option value="Unsubscribed">Unsubscribed</option>
                <option value="complaint">complaint</option>
                <option value="bounced">bounced</option>
                <option value="do-not-contact">do-not-contact</option>
                <option value="existing customer(not ours)">existing customer(not ours)</option>
              </select>
            </div>
          </article>
          <CommercialsEditor
            customerId={customerId}
            title="Commercials"
            value={commercials}
            customerValueTypes={customerValueTypes}
            onSaved={(next) => {
              setCommercials(next);
              onCustomerValueChanged(customerId, {
                customerValueTypeId: next.customerValueTypeId,
                customerValueTypeLabel: next.customerValueTypeLabel,
                customerValueTypeDecimalValue: next.customerValueTypeDecimalValue,
                customerValueTypeShieldOrder: next.customerValueTypeShieldOrder,
                customerValueTypeImageFileName: next.customerValueTypeImageFileName
              });
            }}
          />
          <article className="detail-card">
            <h4>Notes</h4>
            {notesState.loading && <p className="muted">Loading notes...</p>}
            {notesState.error && <p className="muted">{notesState.error}</p>}
            {!notesState.loading && !notesState.error && (
              notesState.data?.length ? (
                <div className="customer-note-list">
                  {notesState.data.map((note) => (
                    <article className="customer-note-item" key={note.id}>
                      <div className="customer-note-meta">
                        <strong>{note.createdByUserName ?? "Unknown user"}</strong>
                        <span>{formatDateTime(note.createdAt)}</span>
                      </div>
                      <p>{note.noteText}</p>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="muted">No notes yet.</p>
              )
            )}
          </article>
        </div>
        {businessTypeModal}
      </section>
    );
  }

  return (
    <section className="detail-panel inline">
      <div className="detail-header">
        <div>
          <span className="eyebrow">Potential Matches</span>
          <h3>{result.matches.length} prospect match{result.matches.length === 1 ? "" : "es"}</h3>
        </div>
        <div className="panel-actions">
          <Badge text={result.generatedNow ? "Generated now" : "Loaded from database"} />
          <button
            className="page-action-button"
            type="button"
            disabled={leadState.loading || Boolean(leadState.data)}
            onClick={() => void createLead()}
          >
            {leadState.data ? "Lead created" : leadState.loading ? "Creating lead..." : "Create Lead"}
          </button>
          {leadState.data && (
            <button className="secondary-action" type="button" onClick={() => onOpenLead(leadState.data!.id)}>
              Open Lead
            </button>
          )}
        </div>
      </div>
      {leadState.error && <StatusBanner kind="error" message={leadState.error} />}
      <div className="detail-grid customer-match-detail-grid">
        {aiInsightPanel}
        <article className="detail-card">
          {customerDetailsHeader}
          {businessTypeManager}
          <div className="table-search">
            <label htmlFor={`customer-suppression-${customerId}`}>Suppression reason</label>
            <select
              id={`customer-suppression-${customerId}`}
              className="header-select"
              value={suppressionReason}
              disabled={savingSuppression}
              onChange={(event) => void updateSuppression(event.target.value)}
            >
              <option value="">None</option>
              <option value="Unsubscribed">Unsubscribed</option>
              <option value="complaint">complaint</option>
              <option value="bounced">bounced</option>
              <option value="do-not-contact">do-not-contact</option>
              <option value="existing customer(not ours)">existing customer(not ours)</option>
            </select>
          </div>
        </article>
        <CommercialsEditor
          customerId={customerId}
          title="Commercials"
          value={commercials}
          customerValueTypes={customerValueTypes}
          onSaved={(next) => {
            setCommercials(next);
            onCustomerValueChanged(customerId, {
              customerValueTypeId: next.customerValueTypeId,
              customerValueTypeLabel: next.customerValueTypeLabel,
              customerValueTypeDecimalValue: next.customerValueTypeDecimalValue,
              customerValueTypeShieldOrder: next.customerValueTypeShieldOrder,
              customerValueTypeImageFileName: next.customerValueTypeImageFileName
            });
          }}
        />
        <article className="detail-card">
          <h4>Notes</h4>
          {notesState.loading && <p className="muted">Loading notes...</p>}
          {notesState.error && <p className="muted">{notesState.error}</p>}
          {!notesState.loading && !notesState.error && (
            notesState.data?.length ? (
              <div className="customer-note-list">
                {notesState.data.map((note) => (
                  <article className="customer-note-item" key={note.id}>
                    <div className="customer-note-meta">
                      <strong>{note.createdByUserName ?? "Unknown user"}</strong>
                      <span>{formatDateTime(note.createdAt)}</span>
                    </div>
                    <p>{note.noteText}</p>
                  </article>
                ))}
              </div>
            ) : (
              <p className="muted">No notes yet.</p>
            )
          )}
        </article>
      </div>
      <div className="match-list">
        {result.matches.map((match) => (
          <article className="match-card" key={`${match.matchId}-${match.prospectId}`}>
            <div className="match-card-header">
              <div>
                <strong>{match.businessName}</strong>
                <div className="muted mono">{match.prospectId}</div>
              </div>
              <div className="panel-actions">
                <div className="match-score">{Math.round(match.score * 100)}%</div>
                <button
                  className="secondary-action destructive-action"
                  type="button"
                  disabled={match.matchId <= 0 || removingMatchId === match.matchId}
                  onClick={() => void removeMatch(match.matchId)}
                >
                  {match.matchId <= 0 ? "Linked to lead" : removingMatchId === match.matchId ? "Removing..." : "Remove match"}
                </button>
              </div>
            </div>
            <div className="match-card-grid">
              <DetailItem label="Contact" value={match.contactName} />
              <DetailItem label="Email" value={<CopyableEmail email={match.contactEmail} />} />
              <DetailItem label="Owner" value={match.ownerName} />
              <DetailItem label="Address" value={match.addressLine1} />
              <DetailItem label="Postcode" value={match.postcode} />
              <DetailItem label="Status" value={match.status} />
              <DetailItem label="Prospect detail" value={match.hasStoredDetail ? "Stored" : "Not stored"} />
              <DetailItem label="Reasons" value={match.reasons.join(", ")} />
            </div>
          </article>
        ))}
      </div>
      {businessTypeModal}
    </section>
  );
}

function CommercialsEditor({
  customerId,
  title,
  value,
  customerValueTypes,
  onSaved
}: {
  customerId: number;
  title: string;
  value?: CustomerCommercials;
  customerValueTypes: CustomerValueType[];
  onSaved: (next: CustomerCommercials) => void;
}) {
  const [form, setForm] = useState<CustomerCommercialsFormState>(() => commercialsToFormState(value));
  const [saving, setSaving] = useState(false);
  const [savingCustomerValueType, setSavingCustomerValueType] = useState(false);
  const [customerValueMenuOpen, setCustomerValueMenuOpen] = useState(false);

  useEffect(() => {
    setForm(commercialsToFormState(value));
  }, [value]);

  const preview = useMemo(() => calculateCommercialsPreview(form), [form]);
  const selectedCustomerValueType = useMemo(
    () => customerValueTypes.find((row) => String(row.id) === form.customerValueTypeId),
    [customerValueTypes, form.customerValueTypeId]
  );

  useEffect(() => {
    setCustomerValueMenuOpen(false);
  }, [value?.customerValueTypeId]);

  async function saveCustomerValueType(nextCustomerValueTypeId: string) {
    const nextSelectedCustomerValueType = customerValueTypes.find((row) => String(row.id) === nextCustomerValueTypeId);
    setSavingCustomerValueType(true);
    setForm((current) => ({ ...current, customerValueTypeId: nextCustomerValueTypeId }));

    try {
      const response = await fetchWithActor(`${apiBase}/api/customers/${customerId}/suppression`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          updateSuppression: false,
          updateCustomerValueType: true,
          customerValueTypeId: nextCustomerValueTypeId && nextCustomerValueTypeId !== "0" ? Number(nextCustomerValueTypeId) : null
        })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as { commercials?: CustomerCommercials };
      onSaved(data.commercials ?? {
        ...value,
        customerValueTypeId: nextCustomerValueTypeId && nextCustomerValueTypeId !== "0" ? Number(nextCustomerValueTypeId) : undefined,
        customerValueTypeLabel: nextSelectedCustomerValueType?.label,
        customerValueTypeDecimalValue: nextSelectedCustomerValueType?.decimalValue,
        customerValueTypeShieldOrder: nextSelectedCustomerValueType?.shieldOrder,
        customerValueTypeImageFileName: nextSelectedCustomerValueType?.imageFileName
      });
    } finally {
      setSavingCustomerValueType(false);
    }
  }

  async function saveCommercials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);

    try {
      const response = await fetchWithActor(`${apiBase}/api/customers/${customerId}/suppression`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          updateSuppression: false,
          updateCustomerValueType: true,
          creditCardValue: parseDecimalOrNull(form.creditCardValue),
          valuePeriod: form.valuePeriod,
          currentChargePercent: parseDecimalOrNull(form.currentChargePercent),
          proposedChargePercent: parseDecimalOrNull(form.proposedChargePercent),
          customerValueTypeId: form.customerValueTypeId && form.customerValueTypeId !== "0" ? Number(form.customerValueTypeId) : null
        })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as { commercials?: CustomerCommercials };
      onSaved(data.commercials ?? {
        creditCardValue: parseDecimalOrNull(form.creditCardValue) ?? undefined,
        valuePeriod: form.valuePeriod,
        currentChargePercent: parseDecimalOrNull(form.currentChargePercent) ?? undefined,
        proposedChargePercent: parseDecimalOrNull(form.proposedChargePercent) ?? undefined,
        currentChargeAmount: preview.currentChargeAmount ?? undefined,
        proposedChargeAmount: preview.proposedChargeAmount ?? undefined,
        differenceAmount: preview.differenceAmount ?? undefined,
        customerValueTypeId: selectedCustomerValueType?.id,
        customerValueTypeLabel: selectedCustomerValueType?.label,
        customerValueTypeDecimalValue: selectedCustomerValueType?.decimalValue,
        customerValueTypeShieldOrder: selectedCustomerValueType?.shieldOrder,
        customerValueTypeImageFileName: selectedCustomerValueType?.imageFileName
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="detail-card">
      <h4>{title}</h4>
      <form className="search-form compact-form" onSubmit={(event) => void saveCommercials(event)}>
        <div className="table-search-group">
          <div className="table-search">
            <label htmlFor={`commercials-customer-value-${customerId}`}>Customer value type</label>
            <div className="customer-value-picker">
              <button
                id={`commercials-customer-value-${customerId}`}
                className="customer-value-picker-trigger"
                type="button"
                disabled={savingCustomerValueType}
                onClick={() => setCustomerValueMenuOpen((current) => !current)}
              >
                {selectedCustomerValueType ? (
                  <>
                    <img
                      className="customer-value-picker-image"
                      src={getCustomerValueTypeImagePath(selectedCustomerValueType.imageFileName)}
                      alt=""
                      aria-hidden="true"
                    />
                    <span>{selectedCustomerValueType.label || `Shield ${selectedCustomerValueType.shieldOrder}`}</span>
                    <span className="muted">
                      {selectedCustomerValueType.decimalValue !== undefined ? selectedCustomerValueType.decimalValue : ""}
                    </span>
                  </>
                ) : (
                  <span>Unassigned</span>
                )}
                <ChevronDown size={14} aria-hidden />
              </button>
              {customerValueMenuOpen && (
                <div className="customer-value-picker-menu">
                  <button
                    className="customer-value-picker-option"
                    type="button"
                    disabled={savingCustomerValueType}
                    onClick={() => {
                      setCustomerValueMenuOpen(false);
                      void saveCustomerValueType("0");
                    }}
                  >
                    <span>Unassigned</span>
                  </button>
                  {customerValueTypes.map((row) => (
                    <button
                      key={row.id}
                      className="customer-value-picker-option"
                      type="button"
                      disabled={savingCustomerValueType}
                      onClick={() => {
                        setCustomerValueMenuOpen(false);
                        void saveCustomerValueType(String(row.id));
                      }}
                    >
                      <img
                        className="customer-value-picker-image"
                        src={getCustomerValueTypeImagePath(row.imageFileName)}
                        alt=""
                        aria-hidden="true"
                      />
                      <span>{row.label || `Shield ${row.shieldOrder}`}</span>
                      <span className="muted">{row.decimalValue !== undefined ? row.decimalValue : ""}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="table-search">
            <label htmlFor={`commercials-value-${customerId}`}>Credit card value</label>
            <input
              id={`commercials-value-${customerId}`}
              type="number"
              min="0"
              step="0.01"
              value={form.creditCardValue}
              onChange={(event) => setForm((current) => ({ ...current, creditCardValue: event.target.value }))}
            />
          </div>
        </div>
        <div className="table-search-group">
          <div className="table-search">
            <label htmlFor={`commercials-period-${customerId}`}>Period</label>
            <select
              id={`commercials-period-${customerId}`}
              className="header-select"
              value={form.valuePeriod}
              onChange={(event) => setForm((current) => ({ ...current, valuePeriod: event.target.value as "monthly" | "yearly" }))}
            >
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          </div>
          <div className="table-search">
            <label htmlFor={`commercials-current-${customerId}`}>Current charge %</label>
            <input
              id={`commercials-current-${customerId}`}
              type="number"
              min="0"
              max="100"
              step="0.0001"
              value={form.currentChargePercent}
              onChange={(event) => setForm((current) => ({ ...current, currentChargePercent: event.target.value }))}
            />
          </div>
          <div className="table-search">
            <label htmlFor={`commercials-proposed-${customerId}`}>Proposed rate %</label>
            <input
              id={`commercials-proposed-${customerId}`}
              type="number"
              min="0"
              max="100"
              step="0.0001"
              value={form.proposedChargePercent}
              onChange={(event) => setForm((current) => ({ ...current, proposedChargePercent: event.target.value }))}
            />
          </div>
        </div>
        <div className="detail-grid compact-grid">
          <DetailItem label={`Current charge (${preview.periodLabel})`} value={formatCurrency(preview.currentChargeAmount)} />
          <DetailItem label={`Proposed charge (${preview.periodLabel})`} value={formatCurrency(preview.proposedChargeAmount)} />
          <DetailItem label={`Difference (${preview.periodLabel})`} value={formatCurrency(preview.differenceAmount)} />
        </div>
        <div className="page-actions">
          <button className="secondary-action" type="submit" disabled={saving}>
            {saving ? "Saving..." : "Save commercials"}
          </button>
        </div>
      </form>
    </article>
  );
}

function BatchFetchModal({
  state,
  onClose,
  onConfirm
}: {
  state: BatchFetchState;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!state.open) return null;

  const progressPercent = state.total === 0 ? 100 : Math.round((state.completedCount / state.total) * 100);

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="modal-panel"
        aria-modal="true"
        aria-labelledby="batch-fetch-title"
        role="dialog"
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">Prospect Batch Fetch</p>
            <h3 id="batch-fetch-title">Fetch missing prospect details</h3>
          </div>
          {!state.running && (
            <button className="modal-close" type="button" onClick={onClose}>
              Close
            </button>
          )}
        </div>

        {!state.running && !state.completed && (
          <div className="modal-body">
            <p>
              This will run Playwright in the background and fetch Sales-page detail for
              <strong> {state.total}</strong> prospect row{state.total === 1 ? "" : "s"} that do not already have stored detail.
            </p>
            <div className="modal-actions">
              <button className="secondary-action" type="button" onClick={onClose}>
                Cancel
              </button>
              <button className="page-action-button" type="button" onClick={onConfirm}>
                Run Batch Fetch
              </button>
            </div>
          </div>
        )}

        {(state.running || state.completed) && (
          <div className="modal-body">
            <div className="batch-stats">
              <strong>
                {state.completedCount} / {state.total}
              </strong>
              <span>{state.running ? "processed" : "complete"}</span>
            </div>
            <div className="progress-track" aria-hidden="true">
              <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
            </div>
            <div className="batch-summary">
              <span>Fetched: {state.successCount}</span>
              <span>Failed: {state.failedCount}</span>
            </div>
            {state.running && state.currentProspectId && (
              <p className="batch-current">Fetching {state.currentProspectId}</p>
            )}
            {state.completed && (
              <StatusBanner
                kind={state.failedCount ? "error" : "success"}
                message={
                  state.failedCount
                    ? `Batch finished. ${state.successCount} fetched, ${state.failedCount} failed.`
                    : `Batch finished. ${state.successCount} prospect details fetched.`
                }
              />
            )}
            {state.completed && (
              <div className="modal-actions">
                <button className="page-action-button" type="button" onClick={onClose}>
                  Done
                </button>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function BatchArchiveModal({
  state,
  onClose,
  onConfirm,
  scopeLabel,
  title,
  noun,
  actionLabel,
  completionLabel
}: {
  state: BatchArchiveState;
  onClose: () => void;
  onConfirm: () => void;
  scopeLabel: string;
  title: string;
  noun: string;
  actionLabel: string;
  completionLabel: string;
}) {
  if (!state.open) return null;

  const progressPercent = state.total === 0 ? 100 : Math.round((state.completedCount / state.total) * 100);
  const modalTitleId = `${scopeLabel.toLowerCase().replace(/\s+/g, "-")}-archive-title`;

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-panel" aria-modal="true" aria-labelledby={modalTitleId} role="dialog">
        <div className="modal-header">
          <div>
            <p className="eyebrow">{scopeLabel}</p>
            <h3 id={modalTitleId}>{title}</h3>
          </div>
          {!state.running && (
            <button className="modal-close" type="button" onClick={onClose}>
              Close
            </button>
          )}
        </div>

        {!state.running && !state.completed && (
          <div className="modal-body">
            <p>
              This will archive
              <strong> {state.total}</strong> {noun}{state.total === 1 ? "" : "s"} currently selected in {scopeLabel}.
            </p>
            <div className="modal-actions">
              <button className="secondary-action" type="button" onClick={onClose}>
                Cancel
              </button>
              <button className="page-action-button" type="button" onClick={onConfirm}>
                {actionLabel}
              </button>
            </div>
          </div>
        )}

        {(state.running || state.completed) && (
          <div className="modal-body">
            <div className="batch-stats">
              <strong>
                {state.completedCount} / {state.total}
              </strong>
              <span>{state.running ? "processed" : "complete"}</span>
            </div>
            <div className="progress-track" aria-hidden="true">
              <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
            </div>
            <div className="batch-summary">
              <span>Archived: {state.successCount}</span>
              <span>Failed: {state.failedCount}</span>
            </div>
            {state.running && state.currentLabel && (
              <p className="batch-current">Archiving {state.currentLabel}</p>
            )}
            {state.completed && (
              <StatusBanner
                kind={state.failedCount ? "error" : "success"}
                message={
                  state.failedCount
                    ? `Cleanse finished. ${state.successCount} archived, ${state.failedCount} failed.`
                    : `Cleanse finished. ${state.successCount} ${completionLabel}.`
                }
              />
            )}
            {state.completed && (
              <div className="modal-actions">
                <button className="page-action-button" type="button" onClick={onClose}>
                  Done
                </button>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function renderSortHeader(label: string, active: boolean, direction: SortDirection, onClick: () => void) {
  return (
    <button
      className={active ? "sort-header active" : "sort-header"}
      type="button"
      onClick={onClick}
    >
      <span>{label}</span>
      <span className="sort-token">{active ? (direction === "asc" ? "A/Z" : "Z/A") : "A/Z"}</span>
    </button>
  );
}

function compareValues(left: string, right: string, direction: SortDirection) {
  const result = left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
  return direction === "asc" ? result : -result;
}

function normalizeMatchText(value?: string | null) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeEmailLocalPart(value?: string | null) {
  const email = (value ?? "").trim().toLowerCase();
  if (!email.includes("@")) return normalizeMatchText(email);
  return normalizeMatchText(email.split("@")[0]);
}

function includesEitherWay(left?: string | null, right?: string | null) {
  const a = normalizeMatchText(left);
  const b = normalizeMatchText(right);
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

function getProspectRowHighlight(row: ProspectSearchRow, customerContext: ProspectTestCustomerContext | null): ProspectRowHighlight {
  if (!customerContext) {
    return { matched: false, reasons: [] };
  }

  const reasons = new Set<string>();
  const customerBusinessCandidates = [customerContext.entityName, customerContext.tradingName].filter(Boolean) as string[];

  for (const candidate of customerBusinessCandidates) {
    if (includesEitherWay(row.businessName, candidate)) {
      reasons.add("business");
    }
    if (includesEitherWay(row.contactName, candidate)) {
      reasons.add("contact");
    }
    if (includesEitherWay(normalizeEmailLocalPart(row.contactEmail), candidate)) {
      reasons.add("email");
    }
  }

  if (customerContext.postcode && normalizeMatchText(row.businessName).includes(normalizeMatchText(customerContext.postcode))) {
    reasons.add("business");
  }

  return {
    matched: reasons.size > 0,
    reasons: [...reasons]
  };
}

function getProspectTestRowClassName(
  row: ProspectSearchRow,
  selectedProspectId: string,
  customerContext: ProspectTestCustomerContext | null
) {
  const classes = ["clickable-row"];
  if (row.prospectId === selectedProspectId) {
    classes.push("selected");
  }
  if (getProspectRowHighlight(row, customerContext).matched) {
    classes.push("customer-linked-row");
  }
  return classes.join(" ");
}

function getLeadLinkedRowClassName(selected: boolean, hasLead: boolean) {
  const classes = ["clickable-row"];
  if (selected) {
    classes.push("selected");
  }
  if (hasLead) {
    classes.push("lead-linked-row");
  }
  return classes.join(" ");
}

function getCustomerRowClassName(selected: boolean, highlighted: boolean, hasLead: boolean, duplicateCandidate = false) {
  const classes = ["clickable-row"];
  if (selected) {
    classes.push("selected");
  }
  if (highlighted) {
    classes.push("return-highlight-row");
  }
  if (hasLead) {
    classes.push("lead-linked-row");
  }
  if (duplicateCandidate) {
    classes.push("duplicate-candidate-row");
  }
  return classes.join(" ");
}

function getCustomerSearchRowKey(row: CustomerSearchRow) {
  return `${row.customerRef ?? ""}|${row.mid ?? ""}|${row.entity}|${row.tradingName ?? ""}`;
}

function getCustomerSearchRowFilterText(row: CustomerSearchRow) {
  return normalizeMatchText(
    [
      row.customerRef,
      row.mid,
      row.entity,
      row.tradingName,
      row.tradingAddress,
      row.tradingPostcode,
      row.status
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function getCurrentCustomerImportMatch(row: CustomerSearchRow, customers: Customer[]): CustomerImportMatchResult | null {
  const matchedCustomers = customers
    .map((customer) => {
      const reasons = new Set<string>();

      if (
        includesEitherWay(row.entity, customer.entityName) ||
        includesEitherWay(row.entity, customer.tradingName) ||
        includesEitherWay(row.tradingName, customer.entityName) ||
        includesEitherWay(row.tradingName, customer.tradingName)
      ) {
        if (includesEitherWay(row.entity, customer.entityName) || includesEitherWay(row.entity, customer.tradingName)) {
          reasons.add("Entity");
        }
        if (includesEitherWay(row.tradingName, customer.entityName) || includesEitherWay(row.tradingName, customer.tradingName)) {
          reasons.add("Trading name");
        }
      }

      if (includesEitherWay(row.tradingAddress, customer.tradingAddress)) {
        reasons.add("Trading address");
      }

      if (
        normalizeMatchText(row.tradingPostcode) &&
        normalizeMatchText(row.tradingPostcode) === normalizeMatchText(customer.postcode)
      ) {
        reasons.add("Postcode");
      }

      if (!reasons.size) {
        return null;
      }

      return {
        customerId: customer.id,
        entityName: customer.entityName,
        tradingName: customer.tradingName,
        tradingAddress: customer.tradingAddress,
        postcode: customer.postcode,
        regionName: customer.regionName,
        reasons: [...reasons]
      };
    })
    .filter((customer): customer is CustomerImportMatchedCustomer => customer !== null);

  if (!matchedCustomers.length) {
    return null;
  }

  return {
    rowKey: getCustomerSearchRowKey(row),
    row,
    matches: matchedCustomers
  };
}

function renderProspectHighlightReasons(
  row: ProspectSearchRow,
  customerContext: ProspectTestCustomerContext | null,
  field: "businessName" | "contactName" | "contactEmail"
) {
  const highlight = getProspectRowHighlight(row, customerContext);
  if (!highlight.matched) return null;

  const fieldKey = field === "businessName" ? "business" : field === "contactName" ? "contact" : "email";
  if (!highlight.reasons.includes(fieldKey)) return null;

  return <span className="match-chip">Customer {fieldKey}</span>;
}

function renderCustomerStatus(
  status?: string,
  customerKind?: string,
  hasNotes?: boolean,
  hasOwnedChecklistMatch?: boolean,
  customerValueTypeImageFileName?: string,
  attachedProspectCount?: number,
  onOpenNotes?: (() => void) | null,
  onOpenOwnedChecklist?: (() => void) | null
) {
  const isCancelled = status === "cancelled";
  const isCustomer = !status && customerKind === "customer";
  const showAttachedProspects = (attachedProspectCount ?? 0) > 0;
  const showIcons = isCancelled || isCustomer || hasNotes || hasOwnedChecklistMatch || customerValueTypeImageFileName || showAttachedProspects;

  if (!showIcons) {
    return "";
  }

  const icons: ReactNode[] = [];
  const wrapStatusIcon = (content: ReactNode, tooltip: string, key: string) => (
    <span className="customer-status-tooltip-wrap" key={key}>
      {content}
      <span className="customer-status-tooltip" role="tooltip">{tooltip}</span>
    </span>
  );

  if (hasNotes) {
    icons.push(
      wrapStatusIcon(
        onOpenNotes ? (
          <button
            className="customer-status-icon notes customer-status-button"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpenNotes();
            }}
          >
            <FileText size={18} aria-hidden />
          </button>
        ) : (
          <span className="customer-status-icon notes">
            <FileText size={18} aria-hidden />
          </span>
        ),
        "Notes",
        "notes"
      )
    );
  }

  if (showAttachedProspects) {
    const label = `${attachedProspectCount} prospect${attachedProspectCount === 1 ? "" : "s"} attached`;
    icons.push(
      wrapStatusIcon(
        <span className="customer-status-icon prospects">
          <BadgeCheck size={18} aria-hidden />
        </span>,
        label,
        "prospects"
      )
    );
  }

  if (isCancelled) {
    icons.push(
      wrapStatusIcon(
        <span className="customer-status-icon cancelled">
          <Smile size={14} aria-hidden />
        </span>,
        "Cancelled",
        "cancelled"
      )
    );
  }

  if (isCustomer) {
    icons.push(
      wrapStatusIcon(
        <span className="customer-status-icon customer">
          <Ban size={14} aria-hidden />
        </span>,
        "Customer",
        "customer"
      )
    );
  }

  if (hasOwnedChecklistMatch) {
    icons.push(
      wrapStatusIcon(
        onOpenOwnedChecklist ? (
          <button
            className="customer-status-icon owned-checklist customer-status-button"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpenOwnedChecklist();
            }}
          >
            <CircleHelp size={15} aria-hidden />
          </button>
        ) : (
          <span className="customer-status-icon owned-checklist">
            <CircleHelp size={15} aria-hidden />
          </span>
        ),
        "Potential external owner",
        "owned-checklist"
      )
    );
  }

  if (customerValueTypeImageFileName) {
    icons.push(
      wrapStatusIcon(
        <span className="customer-status-icon customer-value-shield">
          <img
            className="customer-status-shield-image"
            src={getCustomerValueTypeImagePath(customerValueTypeImageFileName)}
            alt=""
            aria-hidden="true"
          />
        </span>,
        "Customer value type",
        "customer-value-shield"
      )
    );
  }

  return <span className="customer-status-cell">{icons}</span>;
}

function getCustomerBookmarkDotState(customer: Customer, currentUser: User | null) {
  if (currentUser) {
    return {
      show: customer.isBookmarked,
      color: currentUser.color ?? "#d62828"
    };
  }

  return {
    show: customer.hasAnyBookmark,
    color: customer.hasAnyBookmark ? "#111111" : null
  };
}

function getProspectPageSortValue(row: Prospect, key: ProspectPageSortKey) {
  switch (key) {
    case "businessName":
      return row.businessName ?? "";
    case "contactName":
      return row.contactName ?? "";
    case "postcode":
      return row.postcode ?? "";
    case "addedAt":
      return normalizeDateSortValue(row.addedAt);
  }
}

function getProspectTestSortValue(row: ProspectSearchRow, key: ProspectTestSortKey) {
  switch (key) {
    case "prospectId":
      return row.prospectId ?? "";
    case "businessName":
      return row.businessName ?? "";
    case "contactName":
      return row.contactName ?? "";
    case "createdOn":
      return normalizeDateSortValue(row.createdOn);
  }
}

function getCustomerSortValue(row: Customer, key: CustomerPageSortKey) {
  switch (key) {
    case "entityName":
      return row.entityName ?? "";
    case "tradingName":
      return row.tradingName ?? "";
    case "postcode":
      return row.postcode ?? "";
    case "addedAt":
      return normalizeDateSortValue(row.addedAt);
  }
}

function getLeadSortValue(row: Lead, key: LeadViewState["sortKey"]) {
  switch (key) {
    case "id":
      return row.id.toString().padStart(12, "0");
    case "customerName":
      return row.customerName ?? "";
    case "assignedUserName":
      return row.assignedUserName ?? "";
    case "tradingName":
      return row.tradingName ?? "";
    case "postcode":
      return row.postcode ?? "";
    case "leadPriority":
      return leadPriorityRank[row.leadPriority ?? "medium"].toString().padStart(12, "0");
    case "prospectCount":
      return row.prospectCount.toString().padStart(12, "0");
    case "contactHistoryCount":
      return row.contactHistoryCount.toString().padStart(12, "0");
    case "leadStatus":
      return row.leadStatus ?? "";
    case "createdAt":
      return normalizeDateSortValue(row.createdAt);
  }
}

function getDashboardLeadSortValue(
  row: Lead,
  key: "id" | "customerName" | "tradingName" | "contactEmail" | "postcode" | "leadPriority" | "leadStatus" | "createdAt"
) {
  switch (key) {
    case "id":
      return row.id.toString().padStart(12, "0");
    case "customerName":
      return row.customerName ?? "";
    case "tradingName":
      return row.tradingName ?? "";
    case "contactEmail":
      return row.contactEmail ?? "";
    case "postcode":
      return row.postcode ?? "";
    case "leadPriority":
      return leadPriorityRank[row.leadPriority ?? "medium"].toString().padStart(12, "0");
    case "leadStatus":
      return row.leadStatus ?? "";
    case "createdAt":
      return normalizeDateSortValue(row.createdAt);
  }
}

function getWaveLeadSortValue(
  row: Lead,
  key: "id" | "customerName" | "tradingName" | "postcode" | "leadPriority" | "leadStatus"
) {
  switch (key) {
    case "id":
      return row.id.toString().padStart(12, "0");
    case "customerName":
      return row.customerName ?? "";
    case "tradingName":
      return row.tradingName ?? "";
    case "postcode":
      return row.postcode ?? "";
    case "leadPriority":
      return leadPriorityRank[row.leadPriority ?? "medium"].toString().padStart(12, "0");
    case "leadStatus":
      return row.leadStatus ?? "";
  }
}

function getDashboardCustomerSortValue(
  row: Customer,
  key: "entityName" | "tradingName" | "customerActivityStatusName" | "regionName" | "postcode" | "status" | "addedAt"
) {
  switch (key) {
    case "entityName":
      return row.entityName ?? "";
    case "tradingName":
      return row.tradingName ?? "";
    case "customerActivityStatusName":
      return row.customerActivityStatusName ?? "";
    case "regionName":
      return row.regionName ?? "";
    case "postcode":
      return row.postcode ?? "";
    case "status":
      return row.status ?? "";
    case "addedAt":
      return normalizeDateSortValue(row.addedAt);
  }
}

function normalizeDateSortValue(value?: string) {
  if (!value) return "";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return new Date(parsed).toISOString();
}

function parseDateTimeFilter(value?: string) {
  if (!value?.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseRowDateTime(value?: string) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function ApiStatus() {
  const health = useApi<{ status: string; databaseTime: string }>("/health", 0);

  if (health.loading) {
    return <div className="status-pill">Checking API</div>;
  }

  if (health.error) {
    return (
      <div className="status-pill error">
        <CircleAlert size={16} aria-hidden />
        <span>API offline</span>
      </div>
    );
  }

  return (
    <div className="status-pill ok">
      <BadgeCheck size={16} aria-hidden />
      <span>API connected</span>
    </div>
  );
}

function StatusBanner({ kind, message }: { kind: "success" | "error"; message: string }) {
  return <div className={`banner ${kind}`}>{message}</div>;
}

function ActivityEventList({ state }: { state: LoadState<ActivityEvent[]> }) {
  if (state.loading) return <PanelSkeleton compact />;
  if (state.error) return <ErrorPanel error={state.error} compact />;
  if (!state.data?.length) return <EmptyPanel message="No activity events yet." compact />;

  return (
    <div className="activity-feed">
      {state.data.map((event) => (
        <article className="activity-item" key={event.id}>
          <div className="activity-item-header">
            <strong>{event.title}</strong>
            <span className="muted">{formatDateTime(event.createdAt)}</span>
          </div>
          <div>{event.description}</div>
          <div className="activity-item-meta">
            <span>{event.actorName ?? "Unknown user"}</span>
            <span className="mono">#{event.id}</span>
          </div>
        </article>
      ))}
    </div>
  );
}

function ToastStack({
  events,
  currentUserName,
  onDismiss
}: {
  events: ActivityEvent[];
  currentUserName?: string;
  onDismiss: (eventId: number) => void;
}) {
  if (!events.length) return null;

  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {events.map((event) => (
        <article className="toast-card" key={event.id}>
          <div className="toast-card-header">
            <strong>{event.title}</strong>
            <button className="icon-button" type="button" onClick={() => onDismiss(event.id)} aria-label="Dismiss event">
              Ã—
            </button>
          </div>
          <div>{event.description}</div>
          <div className="activity-item-meta">
            <span>{event.actorName ?? currentUserName ?? "Unknown user"}</span>
            <span>{formatDateTime(event.createdAt)}</span>
          </div>
        </article>
      ))}
    </div>
  );
}

function PanelSkeleton({ compact = false }: { compact?: boolean }) {
  return (
    <section className={compact ? "empty-panel compact-panel" : "empty-panel"}>
      <span className="loading-bar" />
      <span className="loading-bar short" />
    </section>
  );
}

function EmptyPanel({ message, compact = false }: { message: string; compact?: boolean }) {
  return <section className={compact ? "empty-panel compact-panel" : "empty-panel"}>{message}</section>;
}

function ErrorPanel({ error, compact = false }: { error: string; compact?: boolean }) {
  return <section className={compact ? "empty-panel compact-panel error-text" : "empty-panel error-text"}>{error}</section>;
}

function Badge({ text }: { text: string }) {
  return <span className="badge">{text}</span>;
}

function fetchWithActor(input: RequestInfo | URL, init?: RequestInit, actorUserIdOverride?: string) {
  const headers = new Headers(init?.headers);
  const actorUserId = actorUserIdOverride ?? window.localStorage.getItem(actorUserStorageKey) ?? "";
  if (actorUserId) {
    headers.set("X-Actor-User-Id", actorUserId);
  }

  return nativeFetch(input, { ...init, headers });
}

function useActivityEvents(refreshKey: number, currentUserId: string) {
  const [state, setState] = useState<LoadState<ActivityEvent[]>>({ loading: true });
  const [toasts, setToasts] = useState<ActivityEvent[]>([]);
  const latestSeenIdRef = useRef(0);
  const initializedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetchWithActor(`${apiBase}/api/activity-events?limit=50`, undefined, currentUserId);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json() as ActivityEvent[];
        if (cancelled) return;

        setState({ data, loading: false });
        const latestId = data.reduce((max, event) => Math.max(max, event.id), 0);
        if (!initializedRef.current) {
          latestSeenIdRef.current = latestId;
          initializedRef.current = true;
          return;
        }

        const nextToasts = data
          .filter((event) =>
            event.id > latestSeenIdRef.current &&
            event.isNotifiable &&
            String(event.actorUserId ?? "") !== currentUserId)
          .reverse();

        if (nextToasts.length) {
          setToasts((current) => {
            const seen = new Set(current.map((event) => event.id));
            const merged = [...nextToasts.filter((event) => !seen.has(event.id)), ...current];
            return merged.slice(0, 5);
          });
        }

        latestSeenIdRef.current = Math.max(latestSeenIdRef.current, latestId);
      } catch (error) {
        if (cancelled) return;
        setState((current) => ({
          data: current.data,
          error: error instanceof Error ? error.message : "Could not load activity.",
          loading: false
        }));
      }
    };

    void load();
    const timer = window.setInterval(() => void load(), 15000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [currentUserId, refreshKey]);

  return {
    state,
    toasts,
    dismissToast: (eventId: number) => setToasts((current) => current.filter((event) => event.id !== eventId))
  };
}

function useApi<T>(path: string, refreshKey: number, actorDependency?: string): LoadState<T> {
  const [state, setState] = useState<LoadState<T>>({ loading: true });

  useEffect(() => {
    if (!path) {
      setState({ loading: false });
      return;
    }

    const controller = new AbortController();
    setState((current) => (current.data ? { ...current, loading: true, error: undefined } : { loading: true }));

    fetchWithActor(`${apiBase}${path}`, { signal: controller.signal }, actorDependency)
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<T>;
      })
      .then((data) => setState({ data, loading: false }))
      .catch((error: Error) => {
        if (controller.signal.aborted) return;
        setState((current) =>
          current.data ? { ...current, error: error.message, loading: false } : { error: error.message, loading: false }
        );
      });

    return () => controller.abort();
  }, [path, refreshKey, actorDependency]);

  return state;
}

function formatJobTypeLabel(jobType: string) {
  switch (jobType) {
    case "ai_company_insight":
      return "AI Company Insight";
    default:
      return jobType.replace(/_/g, " ");
  }
}

function formatJobStatusLabel(status: string) {
  switch (status) {
    case "cancel_requested":
      return "Cancel requested";
    default:
      return status.replace(/_/g, " ");
  }
}

function getAiInsightFromJob(job: QueuedJob): BusinessInfo | null {
  if (job.jobType !== "ai_company_insight" || !job.result) {
    return null;
  }

  const insight = job.result.insight;
  if (!insight || typeof insight !== "object") {
    return null;
  }

  return insight as BusinessInfo;
}

function hasCompaniesHouseIdentification(companyNumber?: string | null) {
  const normalized = (companyNumber ?? "").trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return ![
    "n/a",
    "na",
    "not available",
    "not found",
    "unknown",
    "unavailable",
    "sole trader",
    "(sole trader)"
  ].some((token) => normalized === token || normalized.includes(token));
}

function formatDateTime(value?: string) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(parsed);
}

function formatDate(value?: string) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium"
  }).format(parsed);
}

function formatCurrency(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP"
  }).format(value);
}

function parseDecimalOrNull(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function commercialsToFormState(value?: CustomerCommercials): CustomerCommercialsFormState {
  return {
    creditCardValue: value?.creditCardValue?.toString() ?? "",
    valuePeriod: value?.valuePeriod ?? "monthly",
    currentChargePercent: value?.currentChargePercent?.toString() ?? "",
    proposedChargePercent: value?.proposedChargePercent?.toString() ?? "",
    customerValueTypeId: value?.customerValueTypeId ? String(value.customerValueTypeId) : "0"
  };
}

function calculateCommercialsPreview(form: CustomerCommercialsFormState) {
  const creditCardValue = parseDecimalOrNull(form.creditCardValue);
  const currentChargePercent = parseDecimalOrNull(form.currentChargePercent);
  const proposedChargePercent = parseDecimalOrNull(form.proposedChargePercent);
  const currentChargeAmount = creditCardValue !== null && currentChargePercent !== null
    ? roundCurrency(creditCardValue * (currentChargePercent / 100))
    : null;
  const proposedChargeAmount = creditCardValue !== null && proposedChargePercent !== null
    ? roundCurrency(creditCardValue * (proposedChargePercent / 100))
    : null;
  const differenceAmount = currentChargeAmount !== null && proposedChargeAmount !== null
    ? roundCurrency(currentChargeAmount - proposedChargeAmount)
    : null;

  return {
    periodLabel: form.valuePeriod,
    currentChargeAmount,
    proposedChargeAmount,
    differenceAmount
  };
}

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatLeadChannel(value?: string) {
  switch (value) {
    case "email":
      return "Email";
    case "mail":
      return "Mail";
    case "phone_call":
      return "Phone call";
    case "sms":
      return "SMS";
    case "in_person":
      return "In person";
    case "other":
      return "Other";
    default:
      return value ?? "";
  }
}

function formatReasons(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.join(", ") : value;
  } catch {
    return value;
  }
}

function formatAddress(row: CustomerSearchRow) {
  return [row.tradingAddress, row.town, row.county].filter(Boolean).join(", ");
}

function formatProspectAddress(detail: ProspectDetail) {
  return [
    detail.address.line1,
    detail.address.line2,
    detail.address.town,
    detail.address.county,
    detail.address.postcode,
    detail.address.country
  ].filter(Boolean).join(", ");
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);



