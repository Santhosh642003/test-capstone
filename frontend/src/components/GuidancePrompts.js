import React, { useState, useEffect, useRef } from 'react';
import {
  Container,
  Card,
  CardContent,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  CircularProgress,
  Alert,
  Snackbar,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Switch,
  TextField,
  IconButton
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import LockIcon from '@mui/icons-material/Lock';
import VisibilityIcon from '@mui/icons-material/Visibility';
import TransformIcon from '@mui/icons-material/Transform';
import axios from 'axios';
import GuidancePromptSections from './GuidancePromptSections';

// "Any" for either key is sent as null; the Select needs a non-null sentinel.
const ANY = '';

const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY',
  'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH',
  'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'
];

// Debounce for the live preview (prompt text + JSON schema), built by the API.
const PREVIEW_DELAY_MS = 400;

// structure: the prompt_structure being edited (null for the global rubric and
// for a free-text prompt not yet converted). legacyText: the saved text of
// either of those, shown read-only.
const emptyForm = { prompt_id: null, company_type_id: ANY, state_id: ANY, is_active: true, structure: null, legacyText: null };

// The (All / All) row is the scored HCBS rubric, seeded by the migration and
// owned by the product team; the API refuses to change it and the screen only
// shows it. Everything else is a custom prompt, edited in sections
// (GuidancePromptSections) that start as a copy of the global rubric.
const isGlobalRow = (row) => row.company_type_id === null && row.state_id === null;

// A custom row saved before structured prompts: free text only. FWAPI still
// serves it as free-form until it is converted here.
const isLegacyRow = (row) => !isGlobalRow(row) && !row.prompt_structure;

const clone = (value) => JSON.parse(JSON.stringify(value));

export default function GuidancePrompts({ apiurl, environment, user }) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [prompts, setPrompts] = useState([]);
  const [companyTypes, setCompanyTypes] = useState([]);
  const [form, setForm] = useState(null); // null = editor closed
  const [savedForm, setSavedForm] = useState(null); // what the editor was opened with, for hasChanges
  const [readOnly, setReadOnly] = useState(false); // viewing the global rubric
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  const [template, setTemplate] = useState(null); // the sections a new prompt starts from
  const [preview, setPreview] = useState(null); // { system_prompt, output_schema, total_points, errors }
  const [fullPromptOpen, setFullPromptOpen] = useState(false);
  const previewRequest = useRef(0); // drops preview responses that arrive out of order

  useEffect(() => {
    fetchPrompts();
    fetchCompanyTypes();
    setTemplate(null);
    setForm(null);
  }, [apiurl, environment]);

  const structure = form?.structure || null;

  // API CALL: rebuild the prompt preview whenever the sections change
  useEffect(() => {
    if (!structure) {
      setPreview(null);
      return undefined;
    }
    const requestId = ++previewRequest.current;
    const timer = setTimeout(async () => {
      try {
        const response = await axios.post(apiurl + '/guidanceprompts/preview', { prompt_structure: structure });
        if (requestId === previewRequest.current) setPreview(response.data);
      } catch (error) {
        console.error('Error previewing guidance prompt:', error);
      }
    }, PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [structure, apiurl]);

  // API CALL: every prompt row, wildcards first
  const fetchPrompts = async () => {
    setLoading(true);
    try {
      const response = await axios.get(apiurl + '/guidanceprompts');
      setPrompts(response.data);
    } catch (error) {
      console.error('Error fetching guidance prompts:', error);
      setSnackbar({ open: true, message: 'Failed to load guidance prompts', severity: 'error' });
    } finally {
      setLoading(false);
    }
  };

  // API CALL: the default sections (a copy of the global rubric), fetched on first use
  const loadTemplate = async () => {
    if (template) return template;
    try {
      const response = await axios.get(apiurl + '/guidanceprompts/template');
      setTemplate(response.data.prompt_structure);
      return response.data.prompt_structure;
    } catch (error) {
      console.error('Error fetching guidance prompt template:', error);
      setSnackbar({ open: true, message: 'Failed to load the prompt template', severity: 'error' });
      return null;
    }
  };

  // API CALL: business types (defaults.feature_type = 'primaryBusinessType')
  const fetchCompanyTypes = async () => {
    try {
      const response = await axios.get(apiurl + '/company/companyTypes');
      setCompanyTypes(response.data);
    } catch (error) {
      console.error('Error fetching company types:', error);
    }
  };

  const typeName = (id) => {
    if (id === null || id === undefined || id === ANY) return 'All business types';
    const match = companyTypes.find((t) => t.feature_id === id);
    return match ? match.feature_value : `Type ${id}`;
  };

  const stateName = (id) => (id ? id : 'All states');

  const globalPrompt = prompts.find(isGlobalRow);

  const openNew = async () => {
    const sections = await loadTemplate();
    if (!sections) return;
    const next = { ...emptyForm, structure: clone(sections) };
    setPreview(null);
    setReadOnly(false);
    setForm(next);
    setSavedForm(next);
  };

  const openEdit = (row) => {
    setPreview(null);
    setReadOnly(isGlobalRow(row));
    const next = {
      prompt_id: row.prompt_id,
      company_type_id: row.company_type_id === null ? ANY : row.company_type_id,
      state_id: row.state_id === null ? ANY : row.state_id,
      is_active: Boolean(row.is_active),
      structure: row.prompt_structure ? clone(row.prompt_structure) : null,
      legacyText: row.prompt_structure ? null : row.system_prompt
    };
    setForm(next);
    setSavedForm(next);
  };

  // A free-text prompt becomes structured by starting over from the template;
  // the old text stays on screen until saved, to copy from.
  const convertLegacy = async () => {
    const sections = await loadTemplate();
    if (sections) setForm({ ...form, structure: clone(sections) });
  };

  const closeEditor = () => {
    setForm(null);
    setSavedForm(null);
    setReadOnly(false);
    setFullPromptOpen(false);
  };

  const hasChanges = form && savedForm && JSON.stringify(form) !== JSON.stringify(savedForm);
  const previewErrors = preview?.errors || [];

  // API CALL: create or update the prompt in the editor
  const savePrompt = async () => {
    if (!form.structure) {
      setSnackbar({ open: true, message: 'Convert this prompt to sections before saving', severity: 'error' });
      return;
    }
    setSaving(true);
    const body = {
      company_type_id: form.company_type_id === ANY ? null : form.company_type_id,
      state_id: form.state_id === ANY ? null : form.state_id,
      prompt_structure: form.structure,
      is_active: form.is_active,
      user: user?.email || null
    };
    try {
      if (form.prompt_id) {
        await axios.put(apiurl + '/guidanceprompts/' + form.prompt_id, body);
      } else {
        await axios.post(apiurl + '/guidanceprompts', body);
      }
      setSnackbar({ open: true, message: 'Prompt saved', severity: 'success' });
      closeEditor();
      fetchPrompts();
    } catch (error) {
      console.error('Error saving guidance prompt:', error);
      setSnackbar({
        open: true,
        message: error.response?.data?.message || 'Failed to save prompt',
        severity: 'error'
      });
    } finally {
      setSaving(false);
    }
  };

  // API CALL: delete a prompt after the confirm dialog
  const deletePrompt = async () => {
    const target = deleteTarget;
    setDeleteTarget(null);
    try {
      await axios.delete(apiurl + '/guidanceprompts/' + target.prompt_id);
      setSnackbar({ open: true, message: 'Prompt deleted', severity: 'success' });
      if (form && form.prompt_id === target.prompt_id) closeEditor();
      fetchPrompts();
    } catch (error) {
      console.error('Error deleting guidance prompt:', error);
      setSnackbar({
        open: true,
        message: error.response?.data?.message || 'Failed to delete prompt',
        severity: 'error'
      });
    }
  };

  const handleCloseSnackbar = () => {
    setSnackbar({ ...snackbar, open: false });
  };

  const formatDate = (value) => (value ? new Date(value).toLocaleString() : '');

  if (loading && prompts.length === 0) {
    return (
      <Container maxWidth="lg" style={{ marginTop: '20px', textAlign: 'center' }}>
        <CircularProgress />
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" style={{ marginTop: '20px' }}>
      <Card>
        <CardContent>
          <Box mb={2}>
            <Typography variant="h4" gutterBottom>
              AI Guidance Prompts
            </Typography>
            <Typography variant="body2" color="textSecondary" gutterBottom>
              What the AI Companion is asked to do when a worker checks a case note or a form.
              A company gets the most specific active prompt that matches it: business type + state, then business type only,
              then state only, then the global "All / All" prompt.
            </Typography>
            <Typography variant="body2" color="textSecondary" gutterBottom>
              The global prompt is the scored HCBS rubric (score, five service strategies, person-centered details, tips) and is managed by the product team.
              A new custom prompt starts as a copy of it, split into sections: role and task, service strategies, person-centered indicators,
              scoring points (adding up to 100), client context rules and any extra instructions. Edit any section; the prompt text and the
              JSON the AI must answer in are generated from them, and the worker sees a score and strategies just like the global rubric.
            </Typography>
            {!globalPrompt && (
              <Alert severity="warning" sx={{ mt: 2 }}>
                There is no global "All / All" prompt. Companies with no matching custom prompt fall back to the built-in rubric in code.
              </Alert>
            )}
            <Button
              variant="contained"
              color="primary"
              startIcon={<AddIcon />}
              onClick={openNew}
              disabled={!!form}
              sx={{ mt: 2 }}
            >
              New Prompt
            </Button>
          </Box>

          <TableContainer component={Paper} sx={{ mt: 3 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell><strong>Business Type</strong></TableCell>
                  <TableCell><strong>State</strong></TableCell>
                  <TableCell><strong>Status</strong></TableCell>
                  <TableCell><strong>Last Updated</strong></TableCell>
                  <TableCell align="right"><strong>Actions</strong></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {prompts.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} align="center">No prompts yet.</TableCell>
                  </TableRow>
                )}
                {prompts.map((row) => (
                  <TableRow key={row.prompt_id} selected={form?.prompt_id === row.prompt_id} hover>
                    <TableCell>
                      {typeName(row.company_type_id)}
                      <Typography variant="caption" color="textSecondary" display="block">
                        {isGlobalRow(row)
                          ? 'Global rubric'
                          : isLegacyRow(row)
                            ? 'Free text (not yet converted to sections)'
                            : `${row.prompt_structure.strategies.length} strategies · ${row.prompt_structure.indicators.length} indicators`}
                      </Typography>
                    </TableCell>
                    <TableCell>{stateName(row.state_id)}</TableCell>
                    <TableCell>
                      <Chip size="small" label={row.is_active ? 'Active' : 'Inactive'} color={row.is_active ? 'success' : 'default'} />
                    </TableCell>
                    <TableCell>
                      {formatDate(row.updated_on || row.added_on)}
                      {(row.updated_by || row.added_by) && (
                        <Typography variant="caption" color="textSecondary" display="block">
                          by {row.updated_by || row.added_by}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      {isGlobalRow(row) ? (
                        <>
                          <LockIcon fontSize="small" sx={{ color: 'text.disabled', verticalAlign: 'middle', mr: 0.5 }} titleAccess="Managed by the product team" />
                          <IconButton size="small" onClick={() => openEdit(row)} title="View">
                            <VisibilityIcon fontSize="small" />
                          </IconButton>
                        </>
                      ) : (
                        <>
                          <IconButton size="small" onClick={() => openEdit(row)} title="Edit">
                            <EditIcon fontSize="small" />
                          </IconButton>
                          <IconButton size="small" color="error" onClick={() => setDeleteTarget(row)} title="Delete">
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          {form && (
            <Box sx={{ mt: 4 }}>
              <Typography variant="h6" gutterBottom>
                {readOnly ? 'Global Rubric (read-only)' : form.prompt_id ? 'Edit Prompt' : 'New Prompt'}
              </Typography>
              {readOnly && (
                <Alert severity="info" sx={{ mb: 2 }}>
                  This is the scored rubric every company gets unless a custom prompt matches it. It is managed by the product team and cannot be edited here.
                </Alert>
              )}
              {hasChanges && (
                <Alert severity="info" sx={{ mb: 2 }}>
                  You have unsaved changes. Click "Save Prompt" to apply them.
                </Alert>
              )}
              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center', mb: 2 }}>
                <FormControl size="small" sx={{ minWidth: 260 }}>
                  <InputLabel id="gp-type-label">Business Type</InputLabel>
                  <Select
                    labelId="gp-type-label"
                    label="Business Type"
                    value={form.company_type_id}
                    disabled={readOnly}
                    onChange={(e) => setForm({ ...form, company_type_id: e.target.value })}
                  >
                    <MenuItem value={ANY}>All business types</MenuItem>
                    {companyTypes.map((t) => (
                      <MenuItem key={t.feature_id} value={t.feature_id}>{t.feature_value}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControl size="small" sx={{ minWidth: 160 }}>
                  <InputLabel id="gp-state-label">State</InputLabel>
                  <Select
                    labelId="gp-state-label"
                    label="State"
                    value={form.state_id}
                    disabled={readOnly}
                    onChange={(e) => setForm({ ...form, state_id: e.target.value })}
                  >
                    <MenuItem value={ANY}>All states</MenuItem>
                    {US_STATES.map((s) => (
                      <MenuItem key={s} value={s}>{s}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControlLabel
                  control={
                    <Switch
                      checked={form.is_active}
                      disabled={readOnly}
                      onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                    />
                  }
                  label="Active"
                />
              </Box>
              {!readOnly && !form.structure && (
                <Alert
                  severity="warning"
                  sx={{ mb: 2 }}
                  action={
                    <Button color="inherit" size="small" startIcon={<TransformIcon />} onClick={convertLegacy}>
                      Convert to sections
                    </Button>
                  }
                >
                  This prompt was written as free text, so workers get a plain-text reply with no score. Converting starts it
                  from the global rubric's sections; the old text stays below until you save, so you can copy anything across.
                </Alert>
              )}
              {form.structure && (
                <GuidancePromptSections
                  structure={form.structure}
                  onChange={(next) => setForm({ ...form, structure: next })}
                  preview={preview}
                  disabled={saving}
                />
              )}
              {form.legacyText !== null && (
                <TextField
                  label={readOnly ? 'System prompt (rubric)' : 'Previous free-text prompt (read-only)'}
                  value={form.legacyText}
                  multiline
                  minRows={readOnly ? 20 : 8}
                  fullWidth
                  sx={{ mt: form.structure ? 1 : 0 }}
                  InputProps={{ readOnly: true, sx: { fontFamily: 'monospace', fontSize: 13 } }}
                />
              )}
              {form.structure && previewErrors.length > 0 && (
                <Alert severity="error" sx={{ mt: 2 }}>
                  Fix these before saving:
                  <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                    {previewErrors.map((err) => <li key={err}>{err}</li>)}
                  </ul>
                </Alert>
              )}
              <Box sx={{ display: 'flex', gap: 1, mt: 2 }}>
                {!readOnly && (
                  <Button
                    variant="contained"
                    color="primary"
                    startIcon={<SaveIcon />}
                    onClick={savePrompt}
                    disabled={saving || !hasChanges || !form.structure || previewErrors.length > 0}
                  >
                    Save Prompt
                  </Button>
                )}
                {form.structure && (
                  <Button variant="outlined" startIcon={<VisibilityIcon />} onClick={() => setFullPromptOpen(true)} disabled={!preview}>
                    View Full Prompt
                  </Button>
                )}
                <Button variant="outlined" onClick={closeEditor} disabled={saving}>
                  {readOnly ? 'Close' : 'Cancel'}
                </Button>
              </Box>
            </Box>
          )}
        </CardContent>
      </Card>

      <Dialog open={fullPromptOpen} onClose={() => setFullPromptOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Full prompt sent to the AI</DialogTitle>
        <DialogContent dividers>
          <Box component="pre" sx={{ fontFamily: 'monospace', fontSize: 13, m: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {preview?.system_prompt}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFullPromptOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)}>
        <DialogTitle>Delete this prompt?</DialogTitle>
        <DialogContent dividers>
          {deleteTarget && (
            <Typography>
              {typeName(deleteTarget.company_type_id)} / {stateName(deleteTarget.state_id)}. Companies that matched it will
              fall through to the next most specific prompt.
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={deletePrompt}>Delete</Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={handleCloseSnackbar}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert onClose={handleCloseSnackbar} severity={snackbar.severity} sx={{ width: '100%' }}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Container>
  );
}
