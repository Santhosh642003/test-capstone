// Company business types (defaults.feature_type = 'primaryBusinessType'). IDs are the
// feature_id values stored against each company in the settings table.
export const COMPANY_TYPES = [
  { id: 101, name: 'Support Coordination' },
  { id: 102, name: 'Service Provider' },
  { id: 103, name: 'Home Healthcare' },
  { id: 104, name: 'Case Management' },
  { id: 105, name: 'Day Care Or Community Center' },
];

export const COMPANY_TYPE_NAMES = Object.fromEntries(COMPANY_TYPES.map(({ id, name }) => [id, name]));
