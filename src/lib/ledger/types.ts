export type LedgerDTO = {
  id: string;
  date: string;
  cashIn: number;
  cashOut: number;
  partyId: string | null;
  categoryId: string | null;
  methodId: string | null;
  comments: string;
};

export type LedgerPatch = Partial<Omit<LedgerDTO, "id">>;

export type LedgerFilters = {
  from: string;
  to: string;
  categoryId: string;
  methodId: string;
  partyId: string;
  type: "all" | "in" | "out";
  q: string;
};

export type OptionKind = "category" | "method" | "party";
export type Opt = { id: string; name: string };
