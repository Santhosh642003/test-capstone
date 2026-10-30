import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Snackbar,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import RefreshIcon from '@mui/icons-material/Refresh';
import axios from 'axios';

const AUTHORITY_TYPES = ['1915c', '1115', '1915b', '1915i', '1915k', 'TEFRA'];
const LEVELS_OF_CARE = ['Nursing_Home', 'ICF_IID', 'Hospital'];
const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY',
  'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH',
  'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
];

const EMPTY_FORM = {
  medicaid_program_id: null,
  state_code: '',
  program_name: '',
  cms_control_number: '',
  authority_type: '1915c',
  minimum_age: '',
  maximum_age: '',
  level_of_care_required: '',
  adl_threshold: '',
  fbr_multiplier: '',
  asset_limit: '',
  allows_qit: false,
  allows_spouse_pay: false,
  is_active: true,
  row_version: null,
};

const optionalNumber = (value) => (value === '' ? null : Number(value));
const displayMoney = (value) => value === null || value === undefined
  ? '—'
  : Number(value).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

function apiMessage(error, fallback) {
  return error?.response?.data?.message || fallback;
}

export default function MedicaidPrograms({ apiurl }) {
  const [programs, setPrograms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(true);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

  const loadPrograms = async () => {
    setLoading(true);
    try {
      const response = await axios.get(apiurl + '/medicaidprograms');
      setPrograms(response.data);
    } catch (error) {
      console.error('Error loading Medicaid programs:', error);
      setSnackbar({ open: true, message: apiMessage(error, 'Failed to load Medicaid programs'), severity: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setForm(null);
    setDeleteTarget(null);
    loadPrograms();
  }, [apiurl]); // eslint-disable-line react-hooks/exhaustive-deps

  const visiblePrograms = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return programs.filter((program) => {
      if (!showInactive && !program.is_active) return false;
      if (!needle) return true;
      return [program.state_code, program.program_name, program.cms_control_number, program.authority_type]
        .some((value) => String(value || '').toLowerCase().includes(needle));
    });
  }, [programs, search, showInactive]);

  const editProgram = (program) => setForm({
    ...EMPTY_FORM,
    ...program,
    cms_control_number: program.cms_control_number || '',
    minimum_age: program.minimum_age ?? '',
    maximum_age: program.maximum_age ?? '',
    level_of_care_required: program.level_of_care_required || '',
    adl_threshold: program.adl_threshold ?? '',
    fbr_multiplier: program.fbr_multiplier ?? '',
    asset_limit: program.asset_limit ?? '',
    allows_qit: Boolean(program.allows_qit),
    allows_spouse_pay: Boolean(program.allows_spouse_pay),
    is_active: Boolean(program.is_active),
  });

  const updateField = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  const saveProgram = async () => {
    if (!form.state_code || !form.program_name.trim() || !form.authority_type) {
      setSnackbar({ open: true, message: 'State, program name, and authority type are required', severity: 'error' });
      return;
    }
    if (form.minimum_age !== '' && form.maximum_age !== '' && Number(form.maximum_age) < Number(form.minimum_age)) {
      setSnackbar({ open: true, message: 'Maximum age cannot be less than minimum age', severity: 'error' });
      return;
    }

    const payload = {
      ...form,
      program_name: form.program_name.trim(),
      cms_control_number: form.cms_control_number.trim() || null,
      minimum_age: optionalNumber(form.minimum_age),
      maximum_age: optionalNumber(form.maximum_age),
      level_of_care_required: form.level_of_care_required || null,
      adl_threshold: optionalNumber(form.adl_threshold),
      fbr_multiplier: optionalNumber(form.fbr_multiplier),
      asset_limit: optionalNumber(form.asset_limit),
    };

    setSaving(true);
    try {
      if (form.medicaid_program_id) {
        await axios.put(apiurl + '/medicaidprograms/' + form.medicaid_program_id, payload);
      } else {
        await axios.post(apiurl + '/medicaidprograms', payload);
      }
      setForm(null);
      setSnackbar({ open: true, message: 'Medicaid program saved', severity: 'success' });
      await loadPrograms();
    } catch (error) {
      console.error('Error saving Medicaid program:', error);
      setSnackbar({ open: true, message: apiMessage(error, 'Failed to save Medicaid program'), severity: 'error' });
      if (error?.response?.status === 409) await loadPrograms();
    } finally {
      setSaving(false);
    }
  };

  const deleteProgram = async () => {
    setSaving(true);
    try {
      await axios.delete(apiurl + '/medicaidprograms/' + deleteTarget.medicaid_program_id);
      setDeleteTarget(null);
      setSnackbar({ open: true, message: 'Medicaid program deleted', severity: 'success' });
      await loadPrograms();
    } catch (error) {
      console.error('Error deleting Medicaid program:', error);
      setSnackbar({ open: true, message: apiMessage(error, 'Failed to delete Medicaid program'), severity: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box sx={{ p: 3, width: '100%' }}>
      <Card>
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 2, mb: 2 }}>
            <Box>
              <Typography variant="h5">Medicaid Programs</Typography>
              <Typography variant="body2" color="text.secondary">
                Maintain the Medicaid program catalog used across Fieldworker.
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Tooltip title="Refresh">
                <span>
                  <IconButton onClick={loadPrograms} disabled={loading}><RefreshIcon /></IconButton>
                </span>
              </Tooltip>
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => setForm({ ...EMPTY_FORM })}>
                Add Program
              </Button>
            </Box>
          </Box>

          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 2, flexWrap: 'wrap' }}>
            <TextField
              size="small"
              label="Search programs"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              sx={{ minWidth: 300 }}
            />
            <FormControlLabel
              control={<Switch checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} />}
              label="Show inactive"
            />
            <Typography variant="body2" color="text.secondary">
              {visiblePrograms.length} of {programs.length} programs
            </Typography>
          </Box>

          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
          ) : (
            <TableContainer sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell><strong>State</strong></TableCell>
                    <TableCell><strong>Program</strong></TableCell>
                    <TableCell><strong>Authority</strong></TableCell>
                    <TableCell><strong>CMS Control #</strong></TableCell>
                    <TableCell><strong>Age Range</strong></TableCell>
                    <TableCell><strong>Asset Limit</strong></TableCell>
                    <TableCell><strong>Status</strong></TableCell>
                    <TableCell align="right"><strong>Companies</strong></TableCell>
                    <TableCell align="right"><strong>Actions</strong></TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {!visiblePrograms.length && (
                    <TableRow><TableCell colSpan={9} align="center" sx={{ py: 4 }}>No Medicaid programs found.</TableCell></TableRow>
                  )}
                  {visiblePrograms.map((program) => (
                    <TableRow key={program.medicaid_program_id} hover>
                      <TableCell>{program.state_code}</TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>{program.program_name}</Typography>
                        {program.level_of_care_required && (
                          <Typography variant="caption" color="text.secondary">
                            {program.level_of_care_required.replace(/_/g, ' ')}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>{program.authority_type}</TableCell>
                      <TableCell>{program.cms_control_number || '—'}</TableCell>
                      <TableCell>
                        {program.minimum_age === null && program.maximum_age === null
                          ? '—'
                          : `${program.minimum_age ?? 'Any'} – ${program.maximum_age ?? 'Any'}`}
                      </TableCell>
                      <TableCell>{displayMoney(program.asset_limit)}</TableCell>
                      <TableCell>
                        <Chip size="small" label={program.is_active ? 'Active' : 'Inactive'} color={program.is_active ? 'success' : 'default'} />
                      </TableCell>
                      <TableCell align="right">{program.company_count}</TableCell>
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                        <IconButton size="small" title="Edit" onClick={() => editProgram(program)}><EditIcon fontSize="small" /></IconButton>
                        <IconButton size="small" color="error" title="Delete" onClick={() => setDeleteTarget(program)}><DeleteIcon fontSize="small" /></IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!form} onClose={() => !saving && setForm(null)} maxWidth="md" fullWidth>
        <DialogTitle>{form?.medicaid_program_id ? 'Edit Medicaid Program' : 'Add Medicaid Program'}</DialogTitle>
        {form && (
          <DialogContent dividers>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' }, gap: 2, pt: 0.5 }}>
              <FormControl required size="small">
                <InputLabel id="mp-state-label">State</InputLabel>
                <Select labelId="mp-state-label" label="State" value={form.state_code} onChange={(e) => updateField('state_code', e.target.value)}>
                  {US_STATES.map((state) => <MenuItem key={state} value={state}>{state}</MenuItem>)}
                </Select>
              </FormControl>
              <TextField required size="small" label="Program Name" value={form.program_name} inputProps={{ maxLength: 255 }} onChange={(e) => updateField('program_name', e.target.value)} />
              <TextField size="small" label="CMS Control Number" value={form.cms_control_number} inputProps={{ maxLength: 50 }} onChange={(e) => updateField('cms_control_number', e.target.value)} />
              <FormControl required size="small">
                <InputLabel id="mp-authority-label">Authority Type</InputLabel>
                <Select labelId="mp-authority-label" label="Authority Type" value={form.authority_type} onChange={(e) => updateField('authority_type', e.target.value)}>
                  {AUTHORITY_TYPES.map((type) => <MenuItem key={type} value={type}>{type}</MenuItem>)}
                </Select>
              </FormControl>
              <TextField size="small" type="number" label="Minimum Age" value={form.minimum_age} inputProps={{ min: 0, step: 1 }} onChange={(e) => updateField('minimum_age', e.target.value)} />
              <TextField size="small" type="number" label="Maximum Age" value={form.maximum_age} inputProps={{ min: 0, step: 1 }} onChange={(e) => updateField('maximum_age', e.target.value)} />
              <FormControl size="small">
                <InputLabel id="mp-care-label">Level of Care</InputLabel>
                <Select labelId="mp-care-label" label="Level of Care" value={form.level_of_care_required} onChange={(e) => updateField('level_of_care_required', e.target.value)}>
                  <MenuItem value=""><em>Not specified</em></MenuItem>
                  {LEVELS_OF_CARE.map((level) => <MenuItem key={level} value={level}>{level.replace(/_/g, ' ')}</MenuItem>)}
                </Select>
              </FormControl>
              <TextField size="small" type="number" label="ADL Threshold" value={form.adl_threshold} inputProps={{ min: 0, step: 1 }} onChange={(e) => updateField('adl_threshold', e.target.value)} />
              <TextField size="small" type="number" label="FBR Multiplier" value={form.fbr_multiplier} inputProps={{ min: 0, max: 999.99, step: 0.01 }} onChange={(e) => updateField('fbr_multiplier', e.target.value)} />
              <TextField size="small" type="number" label="Asset Limit" value={form.asset_limit} inputProps={{ min: 0, max: 9999999999.99, step: 0.01 }} onChange={(e) => updateField('asset_limit', e.target.value)} />
              <Box sx={{ gridColumn: { sm: '1 / -1' }, display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                <FormControlLabel control={<Switch checked={form.allows_qit} onChange={(e) => updateField('allows_qit', e.target.checked)} />} label="Allows QIT" />
                <FormControlLabel control={<Switch checked={form.allows_spouse_pay} onChange={(e) => updateField('allows_spouse_pay', e.target.checked)} />} label="Allows spouse pay" />
                <FormControlLabel control={<Switch checked={form.is_active} onChange={(e) => updateField('is_active', e.target.checked)} />} label="Active" />
              </Box>
            </Box>
          </DialogContent>
        )}
        <DialogActions>
          <Button onClick={() => setForm(null)} disabled={saving}>Cancel</Button>
          <Button variant="contained" onClick={saveProgram} disabled={saving}>
            {saving ? 'Saving…' : 'Save Program'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!deleteTarget} onClose={() => !saving && setDeleteTarget(null)}>
        <DialogTitle>Delete Medicaid Program?</DialogTitle>
        <DialogContent dividers>
          <Typography>
            Delete <strong>{deleteTarget?.program_name}</strong>? This cannot be undone.
          </Typography>
          {Number(deleteTarget?.company_count) > 0 && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              This will also remove the program from {deleteTarget.company_count} {Number(deleteTarget.company_count) === 1 ? 'company' : 'companies'}.
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)} disabled={saving}>Cancel</Button>
          <Button color="error" variant="contained" onClick={deleteProgram} disabled={saving}>{saving ? 'Deleting…' : 'Delete'}</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={snackbar.open} autoHideDuration={5000} onClose={() => setSnackbar((value) => ({ ...value, open: false }))} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
        <Alert severity={snackbar.severity} onClose={() => setSnackbar((value) => ({ ...value, open: false }))}>{snackbar.message}</Alert>
      </Snackbar>
    </Box>
  );
}
