import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Form, FormBuilder } from '@formio/react';
import { useDropzone } from 'react-dropzone';
import {
  Alert, Autocomplete, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControl, InputLabel, LinearProgress, MenuItem, Paper, Select, Stack, Tab, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Tabs, TextField, Tooltip, Typography, FormControlLabel, Switch,
} from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import PublishIcon from '@mui/icons-material/Publish';
import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import PdfViewer from './PdfViewer';
import { useNotify } from './Feedback';
import { DEMO_MODE } from '../config';
import { heuristicFlags, flatten, validate } from '../formio/validate';
import {
  COMPANY_TYPES, US_STATES, buildManifest, getImportJob, listCommunityForms, precheck, publishForm, startImport,
} from '../services/formsApi';

const FORM_TYPES = ['Intake', 'Assessment', 'Service Plan', 'Monitoring', 'Incident', 'Consent', 'Visit'];
const EDITABLE_TYPES = ['textfield', 'textarea', 'number', 'currency', 'datetime', 'checkbox', 'signature', 'radio', 'selectboxes', 'select'];
const OPTION_TYPES = ['radio', 'selectboxes'];
const STAGE_LABELS = [
  'Uploading PDF to secure storage',
  'Pre-check: page count, text layer, filled form fields',
  'Reading the form with the model',
  'Validating and repairing the Form.io definition',
  'Building field manifest and confidence flags',
];

// ---- helpers ----
const confidenceLevel = (c) => {
  if (c == null) return null;
  if (c < 0.65) return { label: 'Low', color: 'error' };
  if (c < 0.85) return { label: 'Check', color: 'warning' };
  return { label: 'High', color: 'success' };
};

const fieldFlags = (row, component) => {
  const reasons = [];
  if (row.notes) reasons.push(row.notes);
  heuristicFlags(component).forEach((h) => reasons.push(h));
  const lvl = confidenceLevel(row.confidence);
  const flagged = reasons.length > 0 || (lvl && lvl.color !== 'success');
  return { reasons, flagged, level: lvl ? lvl : (reasons.length ? { label: 'Check', color: 'warning' } : null) };
};

// Applies fn to the component with the given key on a deep copy of the definition.
const editComponent = (definition, key, fn) => {
  const copy = JSON.parse(JSON.stringify(definition));
  const hit = flatten(copy).find((x) => x.component.key === key);
  if (hit) fn(hit.component);
  return copy;
};

const changeType = (c, type) => {
  const options = c.values || c.data?.values || [{ label: 'Option 1', value: 'option1' }, { label: 'Option 2', value: 'option2' }];
  c.type = type;
  if (OPTION_TYPES.includes(type)) { c.values = options; delete c.data; delete c.widget; }
  else if (type === 'select') { c.data = { values: options }; c.widget = 'choicesjs'; delete c.values; }
  else { delete c.values; delete c.data; }
  if (type === 'datetime') c.enableTime = false;
};

class PreviewBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidUpdate(prev) { if (prev.form !== this.props.form && this.state.error) this.setState({ error: null }); }
  render() {
    if (this.state.error) return <Alert severity="error">The form could not be rendered: {String(this.state.error.message || this.state.error)}</Alert>;
    return this.props.children;
  }
}

// ---- Upload step ----
function UploadStep({ onFile, error, busy }) {
  const onDrop = useCallback((files) => { if (files[0]) onFile(files[0]); }, [onFile]);
  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, multiple: false, accept: { 'application/pdf': ['.pdf'] }, disabled: busy });

  const useSample = async () => {
    const res = await fetch(`${process.env.PUBLIC_URL}/demo/sample-isp-intake.pdf`);
    const blob = await res.blob();
    onFile(new File([blob], 'sample-isp-intake.pdf', { type: 'application/pdf' }));
  };

  return (
    <Box sx={{ maxWidth: 760, mx: 'auto', mt: 4 }}>
      <Alert severity="warning" sx={{ mb: 2 }}>
        Upload <b>blank forms only</b>. Never upload a completed form that contains client information —
        the PDF is sent to an AI model for conversion.
      </Alert>
      <Paper
        {...getRootProps()}
        variant="outlined"
        sx={{
          p: 6, textAlign: 'center', cursor: 'pointer', borderStyle: 'dashed', borderWidth: 2,
          borderColor: isDragActive ? 'primary.main' : 'divider', bgcolor: isDragActive ? 'action.hover' : 'background.paper',
        }}
      >
        <input {...getInputProps()} />
        <CloudUploadIcon color="primary" sx={{ fontSize: 56 }} />
        <Typography variant="h6" sx={{ mt: 1 }}>{isDragActive ? 'Drop the PDF here' : 'Drag and drop a PDF form here, or click to browse'}</Typography>
        <Typography variant="body2" color="text.secondary">Text-based PDFs, up to 20 MB and 30 pages</Typography>
      </Paper>
      {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      {DEMO_MODE && (
        <Box sx={{ textAlign: 'center', mt: 3 }}>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
            Demo mode — the model response is simulated for the bundled sample form.
          </Typography>
          <Button variant="outlined" startIcon={<AutoAwesomeIcon />} onClick={useSample} disabled={busy}>Use sample PDF</Button>
        </Box>
      )}
    </Box>
  );
}

// ---- Processing step ----
function ProcessingStep({ filename, job }) {
  const activeIdx = Math.max(0, STAGE_LABELS.indexOf(job?.stage));
  return (
    <Box sx={{ maxWidth: 640, mx: 'auto', mt: 8 }}>
      <Typography variant="h6" gutterBottom>Converting {filename}</Typography>
      <LinearProgress variant={job?.progress ? 'determinate' : 'indeterminate'} value={job?.progress || 0} sx={{ height: 8, borderRadius: 4, mb: 3 }} />
      <Stack spacing={1}>
        {STAGE_LABELS.map((s, i) => (
          <Stack key={s} direction="row" spacing={1} alignItems="center" sx={{ opacity: i > activeIdx ? 0.45 : 1 }}>
            {i < activeIdx ? <CheckCircleIcon color="success" fontSize="small" /> : <RadioButtonUncheckedIcon fontSize="small" color={i === activeIdx ? 'primary' : 'disabled'} />}
            <Typography variant="body2" fontWeight={i === activeIdx ? 600 : 400}>{s}{i === activeIdx ? '…' : ''}</Typography>
          </Stack>
        ))}
      </Stack>
    </Box>
  );
}

// ---- Fields panel ----
function FieldsPanel({ definition, meta, onEdit, onGoToPage }) {
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const rows = useMemo(() => {
    const comps = Object.fromEntries(flatten(definition).map((x) => [x.component.key, x.component]));
    return buildManifest(definition, meta).map((r) => ({ ...r, component: comps[r.key], ...fieldFlags(r, comps[r.key]) }));
  }, [definition, meta]);
  const shown = flaggedOnly ? rows.filter((r) => r.flagged) : rows;

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="body2" color="text.secondary">
          {rows.length} fields · <b>{rows.filter((r) => r.flagged).length} need review</b>
        </Typography>
        <FormControlLabel control={<Switch size="small" checked={flaggedOnly} onChange={(e) => setFlaggedOnly(e.target.checked)} />} label="Needs review only" />
      </Stack>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell width={80}>Confidence</TableCell>
              <TableCell>Label</TableCell>
              <TableCell width={130}>Type</TableCell>
              <TableCell width={70} align="center">Req.</TableCell>
              <TableCell width={50}>Page</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {shown.map((r) => (
              <React.Fragment key={r.key}>
                <TableRow hover sx={r.flagged ? { bgcolor: r.level?.color === 'error' ? 'error.50' : '#fff8e1' } : undefined}>
                  <TableCell>
                    {r.level
                      ? <Chip size="small" color={r.level.color} label={`${r.level.label}${r.confidence != null ? ` ${Math.round(r.confidence * 100)}%` : ''}`} />
                      : <Chip size="small" variant="outlined" label="—" />}
                  </TableCell>
                  <TableCell sx={{ pl: 1 + r.depth }}>
                    {r.type === 'datagrid' || r.component?.type === 'datagrid' ? <b>{r.label} (table)</b> : (
                      <TextField
                        variant="standard" fullWidth size="small" value={r.label}
                        onChange={(e) => onEdit(r.key, (c) => { c.label = e.target.value; })}
                        helperText={<span style={{ fontFamily: 'monospace' }}>{r.key}</span>}
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    {EDITABLE_TYPES.includes(r.type)
                      ? (
                        <Select variant="standard" size="small" value={r.type} fullWidth onChange={(e) => onEdit(r.key, (c) => changeType(c, e.target.value))}>
                          {EDITABLE_TYPES.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                        </Select>
                      )
                      : <Typography variant="body2">{r.type}</Typography>}
                  </TableCell>
                  <TableCell align="center">
                    <Checkbox size="small" checked={r.required} onChange={(e) => onEdit(r.key, (c) => { c.validate = { ...(c.validate || {}), required: e.target.checked }; })} />
                  </TableCell>
                  <TableCell>
                    {r.sourcePage ? <Button size="small" sx={{ minWidth: 0 }} onClick={() => onGoToPage(r.sourcePage)}>p.{r.sourcePage}</Button> : '—'}
                  </TableCell>
                </TableRow>
                {r.flagged && r.reasons.length > 0 && (
                  <TableRow>
                    <TableCell colSpan={5} sx={{ py: 0.5, borderBottom: 0, bgcolor: r.level?.color === 'error' ? 'error.50' : '#fff8e1' }}>
                      <Typography variant="caption" color="text.secondary">⚑ {r.reasons.join(' · ')}</Typography>
                    </TableCell>
                  </TableRow>
                )}
              </React.Fragment>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}

// ---- Publish dialog ----
function PublishDialog({ open, onClose, onPublish, filename, usage, apiurl, busy }) {
  const [d, setD] = useState({
    name: '', description: '', formType: '', companyTypes: [], state: '', agency: '', replacesFormId: null,
  });
  const [existing, setExisting] = useState([]);
  useEffect(() => {
    if (!open) return;
    setD((p) => ({ ...p, name: p.name || filename.replace(/\.pdf$/i, '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()) }));
    listCommunityForms(apiurl).then(setExisting).catch(() => setExisting([]));
  }, [open, apiurl, filename]);
  const set = (k) => (v) => setD((p) => ({ ...p, [k]: v }));
  const valid = d.name.trim() && d.description.trim() && d.formType.trim() && d.state && d.agency.trim() && d.companyTypes.length;

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>Publish as community form</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <TextField label="Form name" required value={d.name} onChange={(e) => set('name')(e.target.value)} fullWidth />
          <TextField label="Description" required value={d.description} onChange={(e) => set('description')(e.target.value)} fullWidth multiline minRows={2} />
          <Autocomplete freeSolo options={FORM_TYPES} value={d.formType} onInputChange={(e, v) => set('formType')(v)} renderInput={(p) => <TextField {...p} label="Form type" required />} />
          <Autocomplete
            multiple options={COMPANY_TYPES} getOptionLabel={(o) => o.label} value={COMPANY_TYPES.filter((t) => d.companyTypes.includes(t.id))}
            onChange={(e, v) => set('companyTypes')(v.map((x) => x.id))}
            renderInput={(p) => <TextField {...p} label="Company type(s)" required />}
          />
          <Stack direction="row" spacing={2}>
            <FormControl fullWidth required>
              <InputLabel>State</InputLabel>
              <Select label="State" value={d.state} onChange={(e) => set('state')(e.target.value)}>
                <MenuItem value="ALL">All states</MenuItem>
                {US_STATES.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
              </Select>
            </FormControl>
            <TextField label="Sponsor / source agency" required value={d.agency} onChange={(e) => set('agency')(e.target.value)} fullWidth />
          </Stack>
          <Autocomplete
            options={existing} getOptionLabel={(o) => `${o.form_name} (#${o.form_id})`} value={existing.find((f) => f.form_id === d.replacesFormId) || null}
            onChange={(e, v) => set('replacesFormId')(v?.form_id ?? null)}
            renderInput={(p) => <TextField {...p} label="Replaces an existing form (optional)" helperText="Revisions get a new form id; subscribers are moved on pack sync and old submissions keep their schema." />}
          />
          <Alert severity="info" icon={false} sx={{ '& .MuiAlert-message': { width: '100%' } }}>
            <Typography variant="caption" component="div"><b>Provenance (saved to form_source)</b></Typography>
            <Typography variant="caption" component="div">Source PDF: {filename} · Model: {usage?.model} · Prompt version: {usage?.promptVersion}</Typography>
          </Alert>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="contained" startIcon={<PublishIcon />} disabled={!valid || busy} onClick={() => onPublish(d)}>
          {busy ? 'Publishing…' : 'Publish'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ---- Review step ----
function ReviewStep({ draft, file, jobId, apiurl, user, onPublished, onRestart }) {
  const notify = useNotify();
  const [definition, setDefinition] = useState(draft.definition);
  const [tab, setTab] = useState('fields');
  const [builderSeed, setBuilderSeed] = useState(draft.definition);
  const [page, setPage] = useState(1);
  const [pdfUrl] = useState(() => URL.createObjectURL(file));
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [pdfPages, setPdfPages] = useState(Math.max(1, ...Object.values(draft.meta).map((m) => m.sourcePage || 1)));
  const pages = pdfPages;
  const problems = useMemo(() => validate(definition), [definition]);
  const flaggedCount = useMemo(() => {
    const comps = Object.fromEntries(flatten(definition).map((x) => [x.component.key, x.component]));
    return buildManifest(definition, draft.meta).filter((r) => fieldFlags(r, comps[r.key]).flagged).length;
  }, [definition, draft.meta]);

  useEffect(() => () => URL.revokeObjectURL(pdfUrl), [pdfUrl]);

  const handleEdit = (key, fn) => setDefinition((prev) => editComponent(prev, key, fn));
  const changeTab = (e, v) => { if (v === 'builder') setBuilderSeed(definition); setTab(v); };

  const doPublish = async (details) => {
    setPublishing(true);
    try {
      const { form_id } = await publishForm(apiurl, { details, definition, usage: draft.usage, filename: file.name, jobId, user });
      setPublishOpen(false);
      onPublished({ form_id, name: details.name });
    } catch (err) {
      console.error(err);
      notify('Could not publish the form. Please try again.', 'error');
    } finally {
      setPublishing(false);
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <Stack direction="row" alignItems="center" spacing={2} sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider' }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="subtitle1" fontWeight={600}>{file.name}</Typography>
          <Typography variant="caption" color="text.secondary">
            {draft.usage.model} · prompt {draft.usage.promptVersion} · {draft.usage.pages} pages · {(draft.usage.promptTokens + draft.usage.completionTokens).toLocaleString()} tokens · {draft.usage.seconds}s
            {draft.usage.repaired ? ` · ${draft.usage.repaired} auto-repair` : ''}
          </Typography>
        </Box>
        {flaggedCount > 0 && <Chip color="warning" label={`${flaggedCount} fields need review`} />}
        <Button onClick={onRestart}>Start over</Button>
        <Tooltip title={problems.length ? 'Fix validation problems first' : ''}>
          <span><Button variant="contained" startIcon={<PublishIcon />} disabled={problems.length > 0} onClick={() => setPublishOpen(true)}>Publish…</Button></span>
        </Tooltip>
      </Stack>

      <Box sx={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Left: source PDF */}
        <Box sx={{ flex: '1 1 45%', display: 'flex', flexDirection: 'column', borderRight: 1, borderColor: 'divider', minWidth: 0 }}>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1, py: 0.5, bgcolor: 'grey.100' }}>
            <Typography variant="caption" fontWeight={700} sx={{ flex: 1 }}>SOURCE PDF</Typography>
            <Button size="small" disabled={page <= 1} onClick={() => setPage(page - 1)}><NavigateBeforeIcon fontSize="small" /></Button>
            <Typography variant="caption">Page {page} / {pages}</Typography>
            <Button size="small" disabled={page >= pages} onClick={() => setPage(page + 1)}><NavigateNextIcon fontSize="small" /></Button>
          </Stack>
          <PdfViewer url={pdfUrl} page={page} onLoaded={setPdfPages} />
        </Box>

        {/* Right: review tabs */}
        <Box sx={{ flex: '1 1 55%', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <Tabs value={tab} onChange={changeTab} sx={{ borderBottom: 1, borderColor: 'divider', minHeight: 40 }}>
            <Tab value="fields" label="Fields" sx={{ minHeight: 40 }} />
            <Tab value="builder" label="Builder" sx={{ minHeight: 40 }} />
            <Tab value="preview" label="Preview" sx={{ minHeight: 40 }} />
          </Tabs>
          <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
            {problems.length > 0 && <Alert severity="error" sx={{ mb: 2 }}>{problems.slice(0, 3).join(' · ')}</Alert>}
            {tab === 'fields' && <FieldsPanel definition={definition} meta={draft.meta} onEdit={handleEdit} onGoToPage={setPage} />}
            {tab === 'builder' && (
              <Box sx={{ textAlign: 'left' }}>
                <FormBuilder form={builderSeed} options={{ builder: { premium: false } }} onChange={(schema) => schema?.components && setDefinition(schema)} />
              </Box>
            )}
            {tab === 'preview' && (
              <PreviewBoundary form={definition}>
                <Form form={definition} options={{ readOnly: false }} />
              </PreviewBoundary>
            )}
          </Box>
        </Box>
      </Box>

      <PublishDialog open={publishOpen} onClose={() => setPublishOpen(false)} onPublish={doPublish} filename={file.name} usage={draft.usage} apiurl={apiurl} busy={publishing} />
    </Box>
  );
}

// ---- Page ----
export default function ImportForm({ apiurl, user, onNavigate }) {
  const [step, setStep] = useState('upload');
  const [file, setFile] = useState(null);
  const [job, setJob] = useState(null);
  const [jobId, setJobId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState('');
  const [published, setPublished] = useState(null);
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const poll = useCallback((jobId) => {
    timer.current = setTimeout(async () => {
      try {
        const res = await getImportJob(apiurl, jobId);
        if (res.status === 'done') { setDraft(res.draft); setStep('review'); }
        else if (res.status === 'failed') { setError(res.error || 'The model could not convert this PDF.'); setStep('upload'); }
        else { setJob(res); poll(jobId); }
      } catch (e) {
        setError('Lost contact with the import service. Please try again.');
        setStep('upload');
      }
    }, 700);
  }, [apiurl]);

  const handleFile = async (f) => {
    setError('');
    const problem = await precheck(f);
    if (problem) { setError(problem); return; }
    setFile(f); setJob(null); setStep('processing');
    try { const id = await startImport(apiurl, f); setJobId(id); poll(id); }
    catch (e) { setError(e.response?.data?.message || 'Upload failed. Please try again.'); setStep('upload'); }
  };

  const restart = () => { clearTimeout(timer.current); setStep('upload'); setFile(null); setDraft(null); setPublished(null); setError(''); };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {step !== 'review' && (
        <Box sx={{ px: 3, pt: 2 }}>
          <Typography variant="h5" fontWeight={600}>Import Form</Typography>
          <Typography variant="body2" color="text.secondary">Turn a state PDF into a Form.io draft, review it against the PDF, and publish it as a community form.</Typography>
        </Box>
      )}
      {step === 'upload' && !published && <UploadStep onFile={handleFile} error={error} busy={false} />}
      {step === 'processing' && <ProcessingStep filename={file?.name} job={job} />}
      {step === 'review' && !published && (
        <ReviewStep draft={draft} file={file} jobId={jobId} apiurl={apiurl} user={user} onPublished={setPublished} onRestart={restart} />
      )}
      {published && (
        <Box sx={{ maxWidth: 640, mx: 'auto', mt: 8, textAlign: 'center' }}>
          <CheckCircleIcon color="success" sx={{ fontSize: 64 }} />
          <Typography variant="h5" sx={{ mt: 1 }}>Published</Typography>
          <Typography sx={{ mb: 3 }}><b>{published.name}</b> (form #{published.form_id}) is now a community form and appears in FieldWorker's Community Forms.</Typography>
          <Stack direction="row" spacing={2} justifyContent="center">
            <Button variant="outlined" onClick={restart}>Import another</Button>
            {onNavigate && <Button variant="contained" onClick={() => onNavigate('formPacks')}>Add to a pack</Button>}
          </Stack>
        </Box>
      )}
    </Box>
  );
}
