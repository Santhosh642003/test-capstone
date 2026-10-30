import React from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Chip,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';

// The section editors for a structured AI guidance prompt (GuidancePrompts.js).
//
// Each section edits one part of prompt_structure; the API
// (FieldworkerMIS helpers/guidancePromptStructure.js) builds the prompt text and
// the JSON schema from it, and is the one that validates. The totals shown
// here are for guidance while typing -- the API says what blocks a save.

export const TOTAL_POINTS = 100;
const MAX_STRATEGIES = 12;
const MAX_INDICATORS = 12;
const MAX_RULES = 20;

// Must match the header the API writes (CLIENT_CONTEXT_HEADER).
const CLIENT_CONTEXT_HEADER = 'CLIENT CONTEXT RULES (apply only when the message contains a block delimited by "--- CLIENT CONTEXT" and "--- END CLIENT CONTEXT ---"):';

const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : 0;
};

export const totalPoints = (structure) =>
  [...structure.strategies, ...structure.indicators].reduce((sum, item) => sum + toNumber(item.points), 0);

const partialPoints = (points, percent) => Math.round((toNumber(points) * toNumber(percent)) / 100);

const monoSx = { fontFamily: 'monospace', fontSize: 13 };

function Section({ number, title, subtitle, chip, children }) {
  return (
    <Accordion defaultExpanded disableGutters variant="outlined" sx={{ mb: 1.5, '&:before': { display: 'none' } }}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, width: '100%', pr: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            {number}. {title}
          </Typography>
          {chip}
        </Box>
      </AccordionSummary>
      <AccordionDetails sx={{ pt: 0 }}>
        {subtitle && (
          <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
            {subtitle}
          </Typography>
        )}
        {children}
      </AccordionDetails>
    </Accordion>
  );
}

function ListItemActions({ index, count, minCount, onMove, onRemove, disabled }) {
  return (
    <Box sx={{ display: 'flex' }}>
      <IconButton size="small" title="Move up" disabled={disabled || index === 0} onClick={() => onMove(index, -1)}>
        <ArrowUpwardIcon fontSize="small" />
      </IconButton>
      <IconButton size="small" title="Move down" disabled={disabled || index === count - 1} onClick={() => onMove(index, 1)}>
        <ArrowDownwardIcon fontSize="small" />
      </IconButton>
      <IconButton size="small" color="error" title="Remove" disabled={disabled || count <= minCount} onClick={() => onRemove(index)}>
        <DeleteIcon fontSize="small" />
      </IconButton>
    </Box>
  );
}

/**
 * @param {Object} props
 * @param {Object} props.structure prompt_structure being edited
 * @param {(next: Object) => void} props.onChange
 * @param {{ output_schema?: string } | null} props.preview latest API preview
 * @param {boolean} [props.disabled]
 */
export default function GuidancePromptSections({ structure, onChange, preview, disabled = false }) {
  const set = (patch) => onChange({ ...structure, ...patch });

  // Generic list helpers for strategies, indicators and client context rules.
  const updateItem = (field, index, patch) =>
    set({ [field]: structure[field].map((item, i) => (i === index ? (typeof item === 'string' ? patch : { ...item, ...patch }) : item)) });
  const removeItem = (field) => (index) => set({ [field]: structure[field].filter((_, i) => i !== index) });
  const moveItem = (field) => (index, delta) => {
    const next = [...structure[field]];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    set({ [field]: next });
  };
  const addItem = (field, item) => set({ [field]: [...structure[field], item] });

  const total = totalPoints(structure);
  const pct = structure.partial_credit_percent;

  // 100 split across every strategy and indicator; the remainder goes to the
  // first items so the total is exact.
  const splitEvenly = () => {
    const count = structure.strategies.length + structure.indicators.length;
    if (!count) return;
    const base = Math.floor(TOTAL_POINTS / count);
    let remainder = TOTAL_POINTS - base * count;
    const share = () => {
      const extra = remainder > 0 ? 1 : 0;
      remainder -= extra;
      return base + extra;
    };
    set({
      strategies: structure.strategies.map((s) => ({ ...s, points: share() })),
      indicators: structure.indicators.map((ind) => ({ ...ind, points: share() }))
    });
  };

  const pointsInput = (value, onValue) => (
    <TextField
      size="small"
      type="number"
      value={value}
      disabled={disabled}
      onChange={(e) => onValue(e.target.value === '' ? '' : Number(e.target.value))}
      inputProps={{ min: 0, max: TOTAL_POINTS, style: { width: 64 } }}
    />
  );

  return (
    <Box>
      <Section
        number={1}
        title="Role & Task"
        subtitle="Who the AI is and what it is evaluating. The line telling it never to rewrite the worker's text and to answer only in JSON is added automatically after this."
      >
        <TextField
          value={structure.intro}
          onChange={(e) => set({ intro: e.target.value })}
          disabled={disabled}
          multiline
          minRows={4}
          fullWidth
          InputProps={{ sx: monoSx }}
        />
      </Section>

      <Section
        number={2}
        title="Service Strategies"
        chip={<Chip size="small" label={structure.strategies.length} />}
        subtitle="Each strategy is scored Covered, Partially Covered or Missing. The name is what the worker sees in the result; the criteria tell the AI what counts."
      >
        {structure.strategies.map((s, i) => (
          <Paper key={i} variant="outlined" sx={{ p: 1.5, mb: 1.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>Strategy {i + 1}</Typography>
              <ListItemActions
                index={i}
                count={structure.strategies.length}
                minCount={1}
                onMove={moveItem('strategies')}
                onRemove={removeItem('strategies')}
                disabled={disabled}
              />
            </Box>
            <TextField
              label="Name"
              size="small"
              value={s.name}
              disabled={disabled}
              onChange={(e) => updateItem('strategies', i, { name: e.target.value })}
              fullWidth
              sx={{ mb: 1.5 }}
            />
            <TextField
              label="What to look for"
              size="small"
              value={s.criteria}
              disabled={disabled}
              onChange={(e) => updateItem('strategies', i, { criteria: e.target.value })}
              multiline
              minRows={2}
              fullWidth
            />
          </Paper>
        ))}
        <Button
          startIcon={<AddIcon />}
          disabled={disabled || structure.strategies.length >= MAX_STRATEGIES}
          onClick={() => addItem('strategies', { name: '', criteria: 'Look for ', points: 0 })}
        >
          Add strategy
        </Button>
      </Section>

      <Section
        number={3}
        title="Person-Centered Indicators"
        chip={<Chip size="small" label={structure.indicators.length} />}
        subtitle="Details the AI extracts from the note and marks Captured or Missing, such as mood or mobility. The hint gives examples of the values to expect."
      >
        {structure.indicators.map((ind, i) => (
          <Box key={i} sx={{ display: 'flex', gap: 1.5, alignItems: 'center', mb: 1.5 }}>
            <TextField
              label="Name"
              size="small"
              value={ind.label}
              disabled={disabled}
              onChange={(e) => updateItem('indicators', i, { label: e.target.value })}
              sx={{ flex: '0 0 220px' }}
            />
            <TextField
              label="Hint"
              size="small"
              placeholder='e.g., Calm, Agitated, Happy'
              value={ind.hint}
              disabled={disabled}
              onChange={(e) => updateItem('indicators', i, { hint: e.target.value })}
              sx={{ flex: 1 }}
            />
            <ListItemActions
              index={i}
              count={structure.indicators.length}
              minCount={0}
              onMove={moveItem('indicators')}
              onRemove={removeItem('indicators')}
              disabled={disabled}
            />
          </Box>
        ))}
        <Button
          startIcon={<AddIcon />}
          disabled={disabled || structure.indicators.length >= MAX_INDICATORS}
          onClick={() => addItem('indicators', { label: '', hint: '', points: 0 })}
        >
          Add indicator
        </Button>
      </Section>

      <Section
        number={4}
        title="Scoring Rules"
        chip={
          <Chip
            size="small"
            color={total === TOTAL_POINTS ? 'success' : 'error'}
            label={`${total} / ${TOTAL_POINTS} points`}
          />
        }
        subtitle={`Points for each strategy and indicator. They must add up to ${TOTAL_POINTS}. A partially covered strategy earns the percentage below of its points. The completeness score is worked out from these points, not left to the AI's arithmetic.`}
      >
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 2, flexWrap: 'wrap' }}>
          <TextField
            label="Partial credit %"
            size="small"
            type="number"
            value={pct}
            disabled={disabled}
            onChange={(e) => set({ partial_credit_percent: e.target.value === '' ? '' : Number(e.target.value) })}
            inputProps={{ min: 0, max: 100, style: { width: 90 } }}
          />
          <Button variant="outlined" size="small" onClick={splitEvenly} disabled={disabled}>
            Split {TOTAL_POINTS} evenly
          </Button>
        </Box>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell><strong>Item</strong></TableCell>
              <TableCell><strong>Full points</strong></TableCell>
              <TableCell><strong>Partially covered</strong></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {structure.strategies.map((s, i) => (
              <TableRow key={`s${i}`}>
                <TableCell>
                  {s.name || <em>Strategy {i + 1}</em>}
                  <Typography variant="caption" color="textSecondary" display="block">Strategy · Covered</Typography>
                </TableCell>
                <TableCell>{pointsInput(s.points, (points) => updateItem('strategies', i, { points }))}</TableCell>
                <TableCell>{partialPoints(s.points, pct)}</TableCell>
              </TableRow>
            ))}
            {structure.indicators.map((ind, i) => (
              <TableRow key={`i${i}`}>
                <TableCell>
                  {ind.label || <em>Indicator {i + 1}</em>}
                  <Typography variant="caption" color="textSecondary" display="block">Indicator · Captured</Typography>
                </TableCell>
                <TableCell>{pointsInput(ind.points, (points) => updateItem('indicators', i, { points }))}</TableCell>
                <TableCell>—</TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell><strong>Total</strong></TableCell>
              <TableCell colSpan={2}>
                <Typography sx={{ fontWeight: 600, color: total === TOTAL_POINTS ? 'success.main' : 'error.main' }}>
                  {total} / {TOTAL_POINTS}
                </Typography>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Section>

      <Section
        number={5}
        title="Client Context Rules"
        chip={<Chip size="small" label={structure.client_context_rules.length} />}
        subtitle="How the AI should use the client's goals, needs and ADL baseline when they are sent with the note. Refer to strategies by name rather than number so the rules still hold if the order changes."
      >
        <Typography variant="caption" color="textSecondary" component="div" sx={{ ...monoSx, fontSize: 12, mb: 1.5 }}>
          {CLIENT_CONTEXT_HEADER}
        </Typography>
        {structure.client_context_rules.map((rule, i) => (
          <Box key={i} sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', mb: 1.5 }}>
            <TextField
              size="small"
              value={rule}
              disabled={disabled}
              onChange={(e) => updateItem('client_context_rules', i, e.target.value)}
              multiline
              minRows={2}
              fullWidth
            />
            <ListItemActions
              index={i}
              count={structure.client_context_rules.length}
              minCount={0}
              onMove={moveItem('client_context_rules')}
              onRemove={removeItem('client_context_rules')}
              disabled={disabled}
            />
          </Box>
        ))}
        <Button
          startIcon={<AddIcon />}
          disabled={disabled || structure.client_context_rules.length >= MAX_RULES}
          onClick={() => addItem('client_context_rules', '')}
        >
          Add rule
        </Button>
      </Section>

      <Section
        number={6}
        title="Additional Instructions"
        subtitle="Optional. Anything else the AI should know, such as state-specific documentation requirements. Leave empty if not needed."
      >
        <TextField
          value={structure.additional_instructions}
          onChange={(e) => set({ additional_instructions: e.target.value })}
          disabled={disabled}
          multiline
          minRows={3}
          fullWidth
          InputProps={{ sx: monoSx }}
        />
      </Section>

      <Section
        number={7}
        title="Response JSON Schema"
        subtitle="Generated from the strategies and indicators above; not editable. The AI is told to answer in exactly this shape, and the worker's guidance window renders it."
      >
        <Box
          component="pre"
          sx={{ ...monoSx, m: 0, p: 1.5, bgcolor: 'grey.100', borderRadius: 1, overflowX: 'auto', whiteSpace: 'pre' }}
        >
          {preview?.output_schema || 'Generating...'}
        </Box>
      </Section>
    </Box>
  );
}
