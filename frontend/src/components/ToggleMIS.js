import React, { useEffect, useState } from "react";
import moment from "moment";
import {
  Box,
  Button,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
} from '@mui/material';
import axios from "axios";
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import DashboardIcon from '@mui/icons-material/Dashboard';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser';
import InsightsIcon from '@mui/icons-material/Insights';
import TravelExploreIcon from '@mui/icons-material/TravelExplore';
import PublicIcon from '@mui/icons-material/Public';
import GroupIcon from '@mui/icons-material/Group';
import TouchAppIcon from '@mui/icons-material/TouchApp';
import ArticleIcon from '@mui/icons-material/Article';
import BusinessIcon from '@mui/icons-material/Business';
import PeopleIcon from '@mui/icons-material/People';
import AssignmentIcon from '@mui/icons-material/Assignment';
import EventIcon from '@mui/icons-material/Event';
import CardMembershipIcon from '@mui/icons-material/CardMembership';
import PaymentsIcon from '@mui/icons-material/Payments';
import NewReleasesIcon from '@mui/icons-material/NewReleases';
import PriceChangeIcon from '@mui/icons-material/PriceChange';
import SchemaIcon from '@mui/icons-material/Schema';
import AddBusinessIcon from '@mui/icons-material/AddBusiness';
import HandshakeIcon from '@mui/icons-material/Handshake';
import TuneIcon from '@mui/icons-material/Tune';
import PsychologyIcon from '@mui/icons-material/Psychology';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline';
import LocalHospitalIcon from '@mui/icons-material/LocalHospital';
import MetabaseDashboard from "./MetabaseDashboard";
import EmbeddedDashboard from "./EmbeddedDashboard";
import CompanyDetails from './CompanyDetails';
import ProjectDetails from './ProjectDetails';
import CompanySummary from './CompanySummary';
import LastDateOfActions from './LastDateOfActions';
import SubscriptionDetails from "./SubscriptionDetails";
import BillingOps from "./BillingOps";
import LogDetails from './LogDetails';
import WhatsNew from "./WhatsNew";
import EVVRates from "./EVVRates";
import FWSchema from "./FWSchema";
import NewCompany from "./NewCompany";
import ReferralCompaniesDashboard from "./ReferralCompaniesDashboard";
import MasterSettings from "./MasterSettings";
import GuidancePrompts from "./GuidancePrompts";
import MedicaidPrograms from "./MedicaidPrograms";
import FeedbackProvider, { useNotify } from "./Feedback";
import 'bootstrap/dist/css/bootstrap.min.css';
import ImportForm from "./ImportForm";
import FormPacks from "./FormPacks";
import UploadFileIcon from '@mui/icons-material/UploadFile';
import InventoryIcon from '@mui/icons-material/Inventory2';
import { MIS_APIURL, FW_APIURL, DEMO_MODE, IMPORT_FORM_ENABLED } from '../config'

export const SIDEBAR_WIDTH = 220;

const GROUPS = [
  { key: 'General', title: 'General' },
  { key: 'Fieldworker Companies', title: 'FW Companies' },
  { key: 'Admin Tools', title: 'Admin Tools' },
];

function ToggleMISInner({ env, user }) {
  const notify = useNotify();
  const [selectedKey, setSelectedKey] = useState(DEMO_MODE ? "importForm" : "fieldworkerSummary");
  const [showRunStatusJobConfirm, setShowRunStatusJobConfirm] = useState(false);
  const [isRunningStatusJob, setIsRunningStatusJob] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState({
    'General': true,
    'Fieldworker Companies': false,
    'Admin Tools': DEMO_MODE
  });

  const environment = {
    dev: env === "dev",
    test: env === "test",
    prod: env === "prod",
  };
  const apiUrl = MIS_APIURL[env] ?? MIS_APIURL.prod;
  const fwApiUrl = FW_APIURL[env] ?? FW_APIURL.prod;

  useEffect(() => {
    setSelectedKey(DEMO_MODE ? "importForm" : "fieldworkerSummary");
    setExpandedGroups({
      'General': true,
      'Fieldworker Companies': false,
      'Admin Tools': DEMO_MODE
    });
  }, [env]);

  const components = [
    { key: "fieldworkerSummary", buttonLabel: "Fieldworker Summary", icon: <DashboardIcon />, component: <MetabaseDashboard dashboardId={22} params={{ month_year: [moment().format('MMMM YYYY')], todaysdate: moment().format('YYYY-MM-DD') }} />, accordionGroup: 'General' },
    { key: "billingSummary", buttonLabel: "Billing Summary", icon: <ReceiptLongIcon />, component: <MetabaseDashboard dashboardId={16} />, accordionGroup: 'General' },
    { key: "evvSummary", buttonLabel: "EVV Summary", icon: <VerifiedUserIcon />, component: <MetabaseDashboard dashboardId={29} params={{ todaysdate: moment().format('YYYY-MM-DD') }} />, accordionGroup: 'General' },
    { key: "productIntelligence", buttonLabel: "Product Intelligence", icon: <InsightsIcon />, component: <EmbeddedDashboard src="https://app.amplitude.com/analytics/share/embed/f33be912-e0f0-4995-92f7-980f00b18539" />, accordionGroup: 'General' },
    { key: "marketIntelligence", buttonLabel: "Market Intelligence", icon: <TravelExploreIcon />, component: <EmbeddedDashboard src="https://app.amplitude.com/analytics/share/embed/df786404-8772-4e20-ac01-5dd2b9faee82" />, accordionGroup: 'General' },
    { key: "prospectsActivity", buttonLabel: "Prospects Activity (Web)", icon: <PublicIcon />, component: <EmbeddedDashboard src="https://app.amplitude.com/analytics/share/embed/0e595f94-6541-4d90-81e7-7df028d53d32" />, accordionGroup: 'General' },
    { key: "productUsers", buttonLabel: "Product Users", icon: <GroupIcon />, component: <EmbeddedDashboard src="https://app.amplitude.com/analytics/share/embed/75ca1e11-bece-4650-95dc-b1546aeb28e2" />, accordionGroup: 'General' },
    { key: "webEngagement", buttonLabel: "Web Engagement", icon: <TouchAppIcon />, component: <EmbeddedDashboard src="https://app.amplitude.com/analytics/share/embed/66de9eda-2f97-4c7b-82b3-0df06b1c3dd6" />, accordionGroup: 'General' },
    { key: "logDetails", buttonLabel: "Log Details", icon: <ArticleIcon />, component: <LogDetails apiurl={apiUrl} />, accordionGroup: 'General' },
    { key: "companySummary", buttonLabel: "Company Summary", icon: <BusinessIcon />, component: <CompanySummary apiurl={apiUrl} />, accordionGroup: 'Fieldworker Companies' },
    { key: "companyDetails", buttonLabel: "Company Details", icon: <PeopleIcon />, component: <CompanyDetails apiurl={apiUrl} />, accordionGroup: 'Fieldworker Companies' },
    { key: "projectDetails", buttonLabel: "Project Details", icon: <AssignmentIcon />, component: <ProjectDetails apiurl={apiUrl} />, accordionGroup: 'Fieldworker Companies' },
    { key: "lastDateOfActions", buttonLabel: "Last Date Of Actions", icon: <EventIcon />, component: <LastDateOfActions apiurl={apiUrl} />, accordionGroup: 'Fieldworker Companies' },
    { key: "subscriptionDetails", buttonLabel: "Subscription Details", icon: <CardMembershipIcon />, component: <SubscriptionDetails apiurl={apiUrl} />, accordionGroup: 'Admin Tools' },
    { key: "billingOperations", buttonLabel: "Billing Operations", icon: <PaymentsIcon />, component: <BillingOps apiurl={apiUrl} user={user} />, accordionGroup: 'Admin Tools' },
    { key: "whatsNew", buttonLabel: "Release Notes Editor", icon: <NewReleasesIcon />, component: <WhatsNew apiurl={apiUrl} />, accordionGroup: 'Admin Tools' },
    { key: "evvRates", buttonLabel: "Manage Rates", icon: <PriceChangeIcon />, component: <EVVRates apiurl={apiUrl} environment={environment} />, accordionGroup: 'Admin Tools' },
    { key: "fwSchema", buttonLabel: "Edit FW Schema", icon: <SchemaIcon />, component: <FWSchema apiurl={apiUrl} user={user} />, accordionGroup: 'Admin Tools' },
    { key: "newCompany", buttonLabel: "Add Company", icon: <AddBusinessIcon />, component: <NewCompany apiurl={apiUrl} environment={environment} />, accordionGroup: 'Admin Tools' },
    { key: "referralCompanies", buttonLabel: "Referral Companies", icon: <HandshakeIcon />, component: <ReferralCompaniesDashboard apiurl={apiUrl} environment={environment} user={user} />, accordionGroup: 'Admin Tools' },
    { key: "masterSettings", buttonLabel: "Master Settings", icon: <TuneIcon />, component: <MasterSettings apiurl={apiUrl} environment={environment} user={user} />, accordionGroup: 'Admin Tools' },
    { key: "guidancePrompts", buttonLabel: "AI Guidance Prompts", icon: <PsychologyIcon />, component: <GuidancePrompts apiurl={apiUrl} environment={environment} user={user} />, accordionGroup: 'Admin Tools' },
    { key: "medicaidPrograms", buttonLabel: "Medicaid Programs", icon: <LocalHospitalIcon />, component: <MedicaidPrograms apiurl={apiUrl} />, accordionGroup: 'Admin Tools' },
    ...(IMPORT_FORM_ENABLED ? [
      { key: "importForm", buttonLabel: "Import Form", icon: <UploadFileIcon />, component: <ImportForm apiurl={fwApiUrl} user={user} onNavigate={setSelectedKey} />, accordionGroup: 'Admin Tools' },
      { key: "formPacks", buttonLabel: "Form Packs", icon: <InventoryIcon />, component: <FormPacks apiurl={fwApiUrl} />, accordionGroup: 'Admin Tools' },
    ] : []),
    { key: "runStatusJob", buttonLabel: "Run Status Job", icon: <PlayCircleOutlineIcon />, accordionGroup: 'Admin Tools' },
  ];

  const selectedComponent = components.find(c => c.key === selectedKey);

  const handleNavigationClick = (component) => {
    if (component.key === "runStatusJob") {
      setShowRunStatusJobConfirm(true);
      return;
    }

    setSelectedKey(component.key);
  };

  const handleRunStatusJob = async () => {
    setIsRunningStatusJob(true);

    try {
      const response = await axios.post(apiUrl + "/customers/RunStatusJob");
      setShowRunStatusJobConfirm(false);
      notify(response.data?.message || "Status job completed successfully", "success");
    } catch (error) {
      notify(error.response?.data?.message || "Status job failed", "error");
    } finally {
      setIsRunningStatusJob(false);
    }
  };

  const toggleGroup = (group) =>
    setExpandedGroups(prev => ({ ...prev, [group]: !prev[group] }));

  return (
    <Box sx={{ display: 'flex', flex: 1, minHeight: 0 }}>
      <Box
        component="nav"
        sx={{
          width: SIDEBAR_WIDTH,
          flex: `0 0 ${SIDEBAR_WIDTH}px`,
          overflowY: 'auto',
          borderRight: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
        }}
      >
        <List dense disablePadding>
          {GROUPS.map(group => (
            <React.Fragment key={group.key}>
              <ListItemButton
                onClick={() => toggleGroup(group.key)}
                sx={{ py: 1, bgcolor: 'grey.50', borderBottom: '1px solid', borderColor: 'divider' }}
              >
                <ListItemText
                  primary={group.title}
                  primaryTypographyProps={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: 'text.secondary' }}
                />
                {expandedGroups[group.key] ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
              </ListItemButton>
              <Collapse in={!!expandedGroups[group.key]} timeout="auto" unmountOnExit>
                <List dense disablePadding>
                  {components
                    .filter(c => c.accordionGroup === group.key)
                    .map(c => (
                      <ListItemButton
                        key={c.key}
                        selected={c.key === selectedKey}
                        onClick={() => handleNavigationClick(c)}
                        sx={{
                          pl: 2,
                          '&.Mui-selected': {
                            bgcolor: 'primary.main',
                            color: 'primary.contrastText',
                            '& .MuiListItemIcon-root': { color: 'primary.contrastText' },
                            '&:hover': { bgcolor: 'primary.dark' },
                          },
                        }}
                      >
                        <ListItemIcon sx={{ minWidth: 34, '& svg': { fontSize: 18 } }}>{c.icon}</ListItemIcon>
                        <ListItemText primary={c.buttonLabel} primaryTypographyProps={{ fontSize: 13, noWrap: true }} />
                      </ListItemButton>
                    ))}
                </List>
              </Collapse>
            </React.Fragment>
          ))}
        </List>
      </Box>

      <Box component="main" sx={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        {/* key forces a remount on nav change, so screens sharing a component type
            (e.g. two MetabaseDashboards) reset their state like distinct components did */}
        {selectedComponent && (
          <React.Fragment key={selectedKey}>{selectedComponent.component}</React.Fragment>
        )}
      </Box>

      <Dialog
        open={showRunStatusJobConfirm}
        onClose={() => setShowRunStatusJobConfirm(false)}
      >
        <DialogTitle>Run Status Job?</DialogTitle>
        <DialogContent dividers>
          Are you sure you want to run the status job on <b>{env.toUpperCase()}</b>?
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowRunStatusJobConfirm(false)}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleRunStatusJob}
            disabled={isRunningStatusJob}
          >
            {isRunningStatusJob ? "Running..." : "Run Status Job"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default function ToggleMIS(props) {
  return (
    <FeedbackProvider>
      <ToggleMISInner {...props} />
    </FeedbackProvider>
  );
}
