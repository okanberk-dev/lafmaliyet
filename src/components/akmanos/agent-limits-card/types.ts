export type ContextSegment = {
  id: string;
  label: string;
  valueK: number;
  percent: number;
  color: string;
  deferred?: boolean;
};

export type ExpandableGroupItem = {
  id: string;
  label: string;
  valueK: number;
};

export type ExpandableGroup = {
  id: string;
  label: string;
  totalK: number;
  itemCount: number;
  items?: ExpandableGroupItem[];
  defaultExpanded?: boolean;
};

export type PlanLimit = {
  id: string;
  label: string;
  resetLabel: string;
  percent: number;
};

export type AgentLimitsContext = {
  usedK: number;
  totalK: number;
  percent: number;
  segments: ContextSegment[];
  expandableGroups?: ExpandableGroup[];
};

export type AgentLimitsPlan = {
  title: string;
  subtitle?: string;
  limits: PlanLimit[];
};
