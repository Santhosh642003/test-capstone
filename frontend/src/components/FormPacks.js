import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, Card, CardActions, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControl, FormControlLabel, IconButton, InputLabel, List, ListItem, ListItemText, MenuItem, Paper, Select, Stack, Switch,
  Tab, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tabs, TextField, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import PublishIcon from '@mui/icons-material/Publish';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutline';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import { useNotify } from './Feedback';
import { DEMO_MODE } from '../config';
import {
  COMPANY_TYPES, US_STATES, companyTypeLabel, getCompanyView, listCommunityForms, listPacks, publishPack, resetDemoData,
  retirePack, savePack, setDemoCompany, subscribePack, unsubscribePack, validatePack,
} from '../services/formsApi';

const STATUS_COLOR = { draft: 'default', published: 'success', retired: 'warning' };
const EMPTY_PACK = { pack_name: '', pack_description: '', company_type: '', state_id: '', items: [] };
const stateLabel = (s) => (s ? s : 'All states');

// ---- Pack editor ----
function PackEditor({ open, pack, forms, onClose, onSave }) {
  const [p, setP] = useState(EMPTY_PACK);
  const [search, setSearch] = useState('');
  const [errors, setErrors] = useState([]);
  useEffect(() => { if (open) { setP(pack || EMPTY_PACK); setErrors([]); setSearch(''); } }, [open, pack]);

  const byId = Object.fromEntries(forms.map((f) => [f.form_id, f]));
  const available = forms.filter((f) => !p.items.includes(f.form_id) && f.form_name.toLowerCase().includes(search.toLowerCase()));
  const move = (i, d) => setP((prev) => {
    const items = [...prev.items];
    [items[i], items[i + d]] = [items[i + d], items[i]];
    return { ...prev, items };
  });
  const save = () => {
    const errs = validatePack({ ...p, state_id: p.state_id === 'ALL' ? null : p.state_id });
    setErrors(errs);
    if (!errs.length) onSave({ ...p, company_type: p.company_type === '' ? null : p.company_type, state_id: p.state_id === 'ALL' ? null : p.state_id });
  };
  const stateValue = p.state_id === null ? 'ALL' : p.state_id;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>{p.pack_id ? `Edit pack — ${p.pack_name}` : 'New form pack'}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <Stack direction="row" spacing={2}>
            <TextField label="Pack name" required fullWidth value={p.pack_name} onChange={(e) => setP({ ...p, pack_name: e.target.value })} />
            <FormControl sx={{ minWidth: 220 }}>
              <InputLabel>Company type</InputLabel>
              <Select label="Company type" value={p.company_type ?? ''} onChange={(e) => setP({ ...p, company_type: e.target.value })}>
                <MenuItem value="">Any type</MenuItem>
                {COMPANY_TYPES.map((t) => <MenuItem key={t.id} value={t.id}>{t.label}</MenuItem>)}
              </Select>
            </FormControl>
            <FormControl sx={{ minWidth: 130 }} required>
              <InputLabel>State</InputLabel>
              <Select label="State" value={stateValue ?? ''} onChange={(e) => setP({ ...p, state_id: e.target.value })}>
                <MenuItem value="ALL">All states</MenuItem>
                {US_STATES.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
              </Select>
            </FormControl>
          </Stack>
          <TextField label="Description" fullWidth value={p.pack_description || ''} onChange={(e) => setP({ ...p, pack_description: e.target.value })} />

          <Stack direction="row" spacing={2}>
            <Paper variant="outlined" sx={{ flex: 1, minWidth: 0 }}>
              <Box sx={{ p: 1.5, borderBottom: 1, borderColor: 'divider' }}>
                <Typography variant="subtitle2">Community forms</Typography>
                <TextField size="small" placeholder="Search…" fullWidth value={search} onChange={(e) => setSearch(e.target.value)} sx={{ mt: 1 }} />
              </Box>
              <List dense sx={{ maxHeight: 280, overflow: 'auto' }}>
                {available.map((f) => (
                  <ListItem key={f.form_id} secondaryAction={<IconButton edge="end" onClick={() => setP({ ...p, items: [...p.items, f.form_id] })}><AddCircleOutlineIcon /></IconButton>}>
                    <ListItemText primary={f.form_name} secondary={`${f.form_type || '—'} · ${f.form_state || 'All'} · #${f.form_id}`} />
                  </ListItem>
                ))}
                {!available.length && <ListItem><ListItemText secondary="No more forms available" /></ListItem>}
              </List>
            </Paper>
            <Paper variant="outlined" sx={{ flex: 1, minWidth: 0 }}>
              <Box sx={{ p: 1.5, borderBottom: 1, borderColor: 'divider' }}><Typography variant="subtitle2">In this pack ({p.items.length})</Typography></Box>
              <List dense sx={{ maxHeight: 330, overflow: 'auto' }}>
                {p.items.map((id, i) => (
                  <ListItem
                    key={id}
                    secondaryAction={(
                      <>
                        <IconButton size="small" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUpwardIcon fontSize="small" /></IconButton>
                        <IconButton size="small" disabled={i === p.items.length - 1} onClick={() => move(i, 1)}><ArrowDownwardIcon fontSize="small" /></IconButton>
                        <IconButton size="small" onClick={() => setP({ ...p, items: p.items.filter((x) => x !== id) })}><RemoveCircleOutlineIcon fontSize="small" /></IconButton>
                      </>
                    )}
                  >
                    <ListItemText primary={`${i + 1}. ${byId[id]?.form_name ?? `Form #${id}`}`} secondary={byId[id]?.form_type} sx={{ pr: 9 }} />
                  </ListItem>
                ))}
                {!p.items.length && <ListItem><ListItemText secondary="Add forms from the left" /></ListItem>}
              </List>
            </Paper>
          </Stack>

          {p.history?.length > 0 && (
            <Box>
              <Typography variant="subtitle2">Version history</Typography>
              {[...p.history].reverse().map((h) => <Typography key={h.version} variant="body2" color="text.secondary">v{h.version} · {h.on} — {h.notes}</Typography>)}
            </Box>
          )}
          {errors.length > 0 && <Alert severity="error">{errors.map((e) => <div key={e}>{e}</div>)}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save}>Save pack</Button>
      </DialogActions>
    </Dialog>
  );
}

// ---- Curation tab ----
function CurationTab({ apiurl, onChanged }) {
  const notify = useNotify();
  const [packs, setPacks] = useState([]);
  const [forms, setForms] = useState([]);
  const [editing, setEditing] = useState(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [publishing, setPublishing] = useState(null);
  const [notes, setNotes] = useState('');

  const refresh = useCallback(async () => {
    const [p, f] = await Promise.all([listPacks(apiurl), listCommunityForms(apiurl)]);
    setPacks(p); setForms(f);
  }, [apiurl]);
  useEffect(() => { refresh().catch(() => notify('Could not load packs', 'error')); }, [refresh, notify]);

  const save = async (pack) => {
    try { await savePack(apiurl, pack); setEditorOpen(false); await refresh(); onChanged(); notify('Pack saved', 'success'); }
    catch (e) { notify('Could not save the pack', 'error'); }
  };
  const doPublish = async () => {
    try {
      const { synced } = await publishPack(apiurl, publishing.pack_id, notes);
      setPublishing(null); setNotes(''); await refresh(); onChanged();
      notify(synced ? `Published — ${synced} subscribed ${synced === 1 ? 'company' : 'companies'} updated` : 'Pack published', 'success');
    } catch (e) { notify('Could not publish the pack', 'error'); }
  };

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" justifyContent="space-between" sx={{ mb: 2 }}>
        <Typography variant="body2" color="text.secondary">Group community forms into versioned packs for a company type and state.</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => { setEditing(null); setEditorOpen(true); }}>New pack</Button>
      </Stack>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Pack</TableCell><TableCell>Company type</TableCell><TableCell>State</TableCell>
              <TableCell align="right">Forms</TableCell><TableCell align="right">Version</TableCell><TableCell>Status</TableCell><TableCell>Published</TableCell><TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {packs.map((p) => (
              <TableRow key={p.pack_id} hover>
                <TableCell><b>{p.pack_name}</b><Typography variant="caption" display="block" color="text.secondary">{p.pack_description}</Typography></TableCell>
                <TableCell>{companyTypeLabel(p.company_type)}</TableCell>
                <TableCell>{stateLabel(p.state_id)}</TableCell>
                <TableCell align="right">{p.items.length}</TableCell>
                <TableCell align="right">v{p.version}</TableCell>
                <TableCell><Chip size="small" label={p.status} color={STATUS_COLOR[p.status]} /></TableCell>
                <TableCell>{p.published_on || '—'}</TableCell>
                <TableCell align="right">
                  <Button size="small" startIcon={<EditIcon />} onClick={() => { setEditing(p); setEditorOpen(true); }}>Edit</Button>
                  {p.status !== 'retired' && (
                    <Button size="small" startIcon={<PublishIcon />} onClick={() => { setNotes(''); setPublishing(p); }}>{p.status === 'published' ? 'New version' : 'Publish'}</Button>
                  )}
                  {p.status === 'published' && <Button size="small" color="warning" onClick={async () => { await retirePack(apiurl, p.pack_id); await refresh(); onChanged(); }}>Retire</Button>}
                </TableCell>
              </TableRow>
            ))}
            {!packs.length && <TableRow><TableCell colSpan={8} align="center">No packs yet</TableCell></TableRow>}
          </TableBody>
        </Table>
      </TableContainer>

      <PackEditor open={editorOpen} pack={editing} forms={forms} onClose={() => setEditorOpen(false)} onSave={save} />

      <Dialog open={!!publishing} onClose={() => setPublishing(null)} fullWidth maxWidth="sm">
        <DialogTitle>{publishing?.status === 'published' ? `Publish v${(publishing?.version || 0) + 1}` : 'Publish pack'} — {publishing?.pack_name}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ my: 1 }}>
            {publishing?.status === 'published'
              ? 'Subscribed companies receive new forms and revised versions on their next load.'
              : 'Once published, companies matching this type and state can subscribe.'}
          </Typography>
          <TextField label="What changed?" fullWidth multiline minRows={2} value={notes} onChange={(e) => setNotes(e.target.value)} autoFocus />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPublishing(null)}>Cancel</Button>
          <Button variant="contained" disabled={publishing?.status === 'published' && !notes.trim()} onClick={doPublish}>Publish</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

// ---- Customer view tab (preview of the FieldWorker Form Library) ----
function CustomerViewTab({ refreshKey }) {
  const notify = useNotify();
  const [view, setView] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const refresh = useCallback(() => getCompanyView().then(setView), []);
  useEffect(() => { refresh(); }, [refresh, refreshKey]);
  if (!view) return null;

  const toggle = async (p) => {
    if (p.subscribed) { await unsubscribePack(p.pack_id); notify(`Unsubscribed from ${p.pack_name}`, 'info'); }
    else { await subscribePack(p.pack_id); notify(`Subscribed — ${p.items.length} forms added to the library`, 'success'); }
    refresh();
  };
  const visible = view.packs.filter((p) => showAll || p.matching);

  return (
    <Box sx={{ p: 3 }}>
      <Alert severity="info" sx={{ mb: 2 }}>
        Preview of the FieldWorker Form Library as seen by a company admin. Subscribing materialises rows into <code>subscribed_form</code>, so existing library queries keep working.
      </Alert>
      <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 3 }}>
        <Typography variant="subtitle1" fontWeight={600}>{view.company.name}</Typography>
        <FormControl size="small" sx={{ minWidth: 220 }}>
          <InputLabel>Business type</InputLabel>
          <Select label="Business type" value={view.company.type} onChange={(e) => { setDemoCompany({ type: e.target.value }); refresh(); }}>
            {COMPANY_TYPES.map((t) => <MenuItem key={t.id} value={t.id}>{t.label}</MenuItem>)}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 100 }}>
          <InputLabel>State</InputLabel>
          <Select label="State" value={view.company.state} onChange={(e) => { setDemoCompany({ state: e.target.value }); refresh(); }}>
            {US_STATES.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
          </Select>
        </FormControl>
      </Stack>

      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="h6">Form Packs</Typography>
        <FormControlLabel control={<Switch checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />} label="Show all" />
      </Stack>
      <Stack direction="row" spacing={2} sx={{ my: 2, flexWrap: 'wrap', rowGap: 2 }}>
        {visible.map((p) => (
          <Card key={p.pack_id} variant="outlined" sx={{ width: 300, opacity: p.matching ? 1 : 0.7 }}>
            <CardContent>
              <Typography variant="subtitle1" fontWeight={600}>{p.pack_name}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ minHeight: 40 }}>{p.pack_description}</Typography>
              <Stack direction="row" spacing={0.5} sx={{ mt: 1, flexWrap: 'wrap' }}>
                <Chip size="small" label={stateLabel(p.state_id)} /><Chip size="small" label={companyTypeLabel(p.company_type)} />
                <Chip size="small" variant="outlined" label={`${p.items.length} forms`} /><Chip size="small" variant="outlined" label={`v${p.version}`} />
              </Stack>
            </CardContent>
            <CardActions>
              <Button size="small" variant={p.subscribed ? 'outlined' : 'contained'} onClick={() => toggle(p)}>{p.subscribed ? 'Unsubscribe' : 'Subscribe'}</Button>
            </CardActions>
          </Card>
        ))}
        {!visible.length && <Typography color="text.secondary">No packs for this company type and state yet. Use “Show all” to browse every pack.</Typography>}
      </Stack>

      <Typography variant="h6" sx={{ mt: 3 }}>Subscribed forms ({view.library.length})</Typography>
      <Paper variant="outlined" sx={{ mt: 1 }}>
        <List dense>
          {view.library.map((r) => (
            <ListItem key={r.form_id}>
              <ListItemText primary={r.form.form_name} secondary={`${r.form.form_type || '—'} · #${r.form_id}`} />
              <Chip size="small" variant="outlined" label={r.pack_id ? `via pack: ${view.packs.find((p) => p.pack_id === r.pack_id)?.pack_name ?? r.pack_id}` : 'individually subscribed'} />
            </ListItem>
          ))}
          {!view.library.length && <ListItem><ListItemText secondary="No forms subscribed" /></ListItem>}
        </List>
      </Paper>
    </Box>
  );
}

export default function FormPacks({ apiurl }) {
  const [tab, setTab] = useState('curate');
  const [refreshKey, setRefreshKey] = useState(0);
  const [resetKey, setResetKey] = useState(0);
  return (
    <Box>
      <Box sx={{ px: 3, pt: 2, display: 'flex', alignItems: 'flex-start' }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h5" fontWeight={600}>Form Packs</Typography>
        </Box>
        {DEMO_MODE && <Button size="small" startIcon={<RestartAltIcon />} onClick={() => { resetDemoData(); setResetKey((k) => k + 1); setRefreshKey((k) => k + 1); }}>Reset demo data</Button>}
      </Box>
      <Tabs value={tab} onChange={(e, v) => setTab(v)} sx={{ px: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Tab value="curate" label="Curate packs" />
        {DEMO_MODE && <Tab value="customer" label="Customer view (preview)" />}
      </Tabs>
      {tab === 'curate' && <CurationTab key={resetKey} apiurl={apiurl} onChanged={() => setRefreshKey((k) => k + 1)} />}
      {DEMO_MODE && tab === 'customer' && <CustomerViewTab refreshKey={refreshKey} />}
    </Box>
  );
}
