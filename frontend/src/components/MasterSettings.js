import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Container,
  Paper,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import axios from 'axios';
import { useNotify } from './Feedback';
import { COMPANY_TYPES } from '../constants';

// Per-company-type defaults that can be toggled here (defaults.feature_type = 'masterSetting').
const FEATURES = [
  { id: 72, name: 'Project Created Automatically', description: 'Automatically create projects for new companies' },
  { id: 77, name: 'Project Never Expires', description: 'Projects never expire for this company type' },
];

const settingKey = (companyTypeId, featureId) => `${companyTypeId}-${featureId}`;

// Every type/feature pair, defaulting to off, overlaid with whatever the API returned.
const toSettingsMap = (apiSettings) => {
  const map = {};
  for (const type of COMPANY_TYPES) {
    for (const feature of FEATURES) {
      map[settingKey(type.id, feature.id)] = false;
    }
  }
  for (const { companyTypeId, featureId, isEnabled } of apiSettings) {
    map[settingKey(companyTypeId, featureId)] = isEnabled;
  }
  return map;
};

const toApiSettings = (settingsMap) =>
  COMPANY_TYPES.flatMap((type) =>
    FEATURES.map((feature) => ({
      companyTypeId: type.id,
      featureId: feature.id,
      isEnabled: settingsMap[settingKey(type.id, feature.id)],
    }))
  );

const headerCellSx = { fontWeight: 'bold', backgroundColor: '#f5f5f5' };

export default function MasterSettings({ apiurl, user }) {
  const notify = useNotify();
  const [savedSettings, setSavedSettings] = useState(null);
  const [settings, setSettings] = useState({});
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    axios.get(`${apiurl}/mastersettings`)
      .then(({ data }) => {
        if (cancelled) return;
        const map = toSettingsMap(Array.isArray(data) ? data : []);
        setSettings(map);
        setSavedSettings(map);
      })
      .catch((err) => {
        console.error('Error fetching settings:', err);
        if (!cancelled) notify('Error loading settings', 'error');
      });

    return () => { cancelled = true; };
  }, [apiurl, notify]);

  const hasChanges = useMemo(
    () => !!savedSettings && Object.keys(settings).some((key) => settings[key] !== savedSettings[key]),
    [settings, savedSettings]
  );

  const toggle = (companyTypeId, featureId) => {
    const key = settingKey(companyTypeId, featureId);
    setSettings((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const save = async () => {
    setIsSaving(true);
    try {
      await axios.put(`${apiurl}/mastersettings`, {
        settings: toApiSettings(settings),
        updatedBy: user.emp_id,
      });
      setSavedSettings(settings);
      notify('Settings saved successfully', 'success');
    } catch (err) {
      console.error('Error saving settings:', err);
      notify('Error saving settings', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  if (!savedSettings) {
    return (
      <Container maxWidth="lg" sx={{ mt: '20px', textAlign: 'center' }}>
        <CircularProgress />
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ mt: '20px' }}>
      <Card>
        <CardContent>
          <Box mb={2}>
            <Typography variant="h4" gutterBottom>
              Master Settings
            </Typography>
            <Typography variant="body2" color="textSecondary" gutterBottom>
              Configure default settings for company types. These apply to all companies of the selected type unless overridden at the company level.
            </Typography>
            {hasChanges && (
              <Alert severity="info" sx={{ mt: 2 }}>
                You have unsaved changes. Click "Save Changes" to apply them.
              </Alert>
            )}
            <Button
              variant="contained"
              startIcon={<SaveIcon />}
              onClick={save}
              disabled={isSaving || !hasChanges}
              sx={{ mt: 2 }}
            >
              Save Changes
            </Button>
          </Box>

          <TableContainer component={Paper} sx={{ mt: 3 }}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell sx={headerCellSx}>Company Type</TableCell>
                  {FEATURES.map((feature) => (
                    <TableCell key={feature.id} align="center" sx={headerCellSx} title={feature.description}>
                      <div>{feature.name}</div>
                      <Typography variant="caption" color="textSecondary">
                        (Feature {feature.id})
                      </Typography>
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {COMPANY_TYPES.map((type) => (
                  <TableRow key={type.id} hover>
                    <TableCell component="th" scope="row">
                      <Typography variant="body1">{type.name}</Typography>
                      <Typography variant="caption" color="textSecondary">
                        Type ID: {type.id}
                      </Typography>
                    </TableCell>
                    {FEATURES.map((feature) => (
                      <TableCell key={feature.id} align="center">
                        <Switch
                          checked={settings[settingKey(type.id, feature.id)]}
                          onChange={() => toggle(type.id, feature.id)}
                          disabled={isSaving}
                        />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>
    </Container>
  );
}
