import React, { useState } from 'react';
import { FormBuilder } from '@formio/react';
import {
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  FormGroup,
  IconButton,
  TextField,
  Typography,
} from '@mui/material';
import InfoIcon from '@mui/icons-material/Info';
import axios from 'axios';
import { useNotify } from './Feedback';

const LANGUAGES = [
  { value: 'es', label: 'Spanish' },
];

// Forms created from dev/test are attributed to a fixed test employee rather than the signed-in admin.
const TEST_ENV_EMP_ID = 700026;

const EMPTY_DETAILS = { title: '', description: '', type: '', language: null };

function InfoBox() {
  return (
    <Box
      sx={{
        position: 'absolute',
        top: 0,
        left: 40,
        zIndex: 10,
        backgroundColor: '#fafafa',
        border: '1px solid #ccc',
        borderRadius: '10px',
        padding: '16px 20px',
        fontFamily: 'Lato',
        boxShadow: 2,
        width: '500px',
        animation: 'fadeIn 0.3s',
      }}
    >
      <Typography variant="h6" sx={{ mb: 1 }}>
        📋 How to use the Form Builder
      </Typography>
      <Typography variant="body1" sx={{ mb: 2 }}>
        With this tool, you can easily create custom forms tailored to your needs.
      </Typography>
      <Typography variant="subtitle1" sx={{ mb: 1 }}>
        Getting Started:
      </Typography>
      <Typography variant="body2" sx={{ mb: 2, lineHeight: 1.6 }}>
        Drag and drop desired form components from the left panel onto the canvas.
        Hover over a component to customize its properties or remove it. Use the
        "Move" button to reposition components. Once satisfied, click "Add Form" to
        save it.
      </Typography>
      <Typography variant="subtitle1" sx={{ mb: 1 }}>
        Supported Components:
      </Typography>
      <ul style={{ paddingLeft: '20px', marginBottom: '16px' }}>
        <li>
          <Typography variant="body2">
            <strong>Basic Section:</strong> All fields.
          </Typography>
        </li>
        <li>
          <Typography variant="body2">
            <strong>Advanced Section:</strong> Date/Time, Day and Time.
          </Typography>
        </li>
      </ul>
    </Box>
  );
}

export default function FormsBuilder({ apiurl, env, user, comp_id, onSuccess }) {
  const notify = useNotify();
  const [formSchema, setFormSchema] = useState({});
  const [details, setDetails] = useState(EMPTY_DETAILS);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const componentCount = formSchema.components?.length ?? 0;
  const canSubmit = details.title.trim() !== '' && details.type.trim() !== '';

  const setDetail = (name) => (value) => setDetails((prev) => ({ ...prev, [name]: value }));

  const openDialog = () => {
    setDetails(EMPTY_DETAILS);
    setDialogOpen(true);
  };

  const addForm = async () => {
    setIsSaving(true);
    try {
      // form_id is assigned client-side as MAX(form_id) + 1; the endpoint returns the
      // un-aliased aggregate, hence the "" key.
      const { data } = await axios.get(`${apiurl}/forms/formbuilder`);
      const maxFormId = data[0]?.[''] || 0;

      await axios.post(`${apiurl}/forms`, {
        form_id: maxFormId + 1,
        form_name: details.title,
        form_description: details.description,
        form_added_by: env.dev || env.test ? TEST_ENV_EMP_ID : user.emp_id,
        form_type: details.type,
        json_schema: formSchema,
        form_company: comp_id,
        public_form: 1,
        form_language: details.language?.value ?? null,
      });

      notify('Form successfully added', 'success');
      setDialogOpen(false);
      onSuccess?.();
    } catch (err) {
      console.error('Error adding form:', err);
      notify('An error occurred while trying to add the form', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex' }}>
          <h5>Welcome to the Form Builder!</h5>
          <Box sx={{ position: 'relative', marginLeft: 1 }}>
            <IconButton sx={{ p: 0 }} onClick={() => setInfoOpen((prev) => !prev)}>
              <InfoIcon color="primary" />
            </IconButton>
            {infoOpen && <InfoBox />}
          </Box>
        </div>
        <Button variant="contained" onClick={openDialog} disabled={componentCount <= 1}>
          Add Form
        </Button>
      </div>

      <div style={{ border: '1px solid #ccc', padding: 10, marginTop: 10, textAlign: 'left' }}>
        <FormBuilder form={{ display: 'form' }} options={{ builder: { premium: false } }} onChange={setFormSchema} />
      </div>

      <Dialog fullWidth maxWidth="sm" open={dialogOpen} onClose={() => setDialogOpen(false)}>
        <DialogTitle sx={{ width: '100%', textAlign: 'center', borderBottom: '1px solid lightgray' }}>
          Add Form
        </DialogTitle>
        <DialogContent sx={{ paddingTop: 0 }}>
          <TextField
            label="Form Title"
            required
            value={details.title}
            sx={{ my: 2 }}
            onChange={(e) => setDetail('title')(e.target.value)}
            fullWidth
            error={!details.title}
          />
          <TextField
            label="Form Description"
            value={details.description}
            sx={{ my: 2 }}
            onChange={(e) => setDetail('description')(e.target.value)}
            fullWidth
          />
          <TextField
            label="Form Type"
            required
            value={details.type}
            sx={{ my: 2 }}
            onChange={(e) => setDetail('type')(e.target.value)}
            fullWidth
            error={!details.type}
          />
          <Autocomplete
            options={LANGUAGES}
            value={details.language}
            getOptionLabel={(option) => option.label}
            isOptionEqualToValue={(option, value) => option.value === value.value}
            onChange={(e, value) => setDetail('language')(value)}
            renderInput={(params) => (
              <TextField {...params} label="Select Language" helperText="Language the form will be translated to. Default: English" />
            )}
            sx={{ my: 2 }}
          />
          <FormGroup>
            <FormControlLabel control={<Checkbox checked disabled />} label="Community Form" />
          </FormGroup>
          <Button variant="contained" fullWidth onClick={addForm} disabled={!canSubmit || isSaving}>
            Add Form
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
