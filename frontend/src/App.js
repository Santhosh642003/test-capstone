import './App.css';
import React from 'react';
import { Alert, Avatar, Box, Button, CircularProgress, Divider, IconButton, ListItemIcon, Menu, MenuItem, Paper, ToggleButtonGroup, ToggleButton, Typography } from '@mui/material';
import LogoutIcon from '@mui/icons-material/Logout';
import ToggleMIS from './components/ToggleMIS';
import * as Msal from "msal";
import { APIURL, SCOPE, CLIENT_ID, MSTENANT, MUI_KEY, DEMO_MODE } from './config'
import moment from 'moment'
import axios from 'axios'
import { LicenseInfo } from '@mui/x-data-grid-pro';
LicenseInfo.setLicenseKey(MUI_KEY)

class App extends React.Component {
  constructor(props) {
    super(props)
    this.msalInstance = new Msal.UserAgentApplication({
      auth: {
        clientId: CLIENT_ID,
        authority: MSTENANT
      }
    })
    this.loginRequest = {
      scopes: ["User.Read"]
    };
    this.loginUser = this.loginUser.bind(this)
    this.getUserFromDB = this.getUserFromDB.bind(this)
    this.logoutUser = this.logoutUser.bind(this)
    this.getUserDetails = this.getUserDetails.bind(this)

    this.state = {
      isAuth: DEMO_MODE,
      user: DEMO_MODE ? { emp_id: 700026, emp_name: 'Demo Support Engineer', email: 'demo@fieldworker.ai', comp_id: 2000, type: 'Admin' } : {},
      isLoading: false,
      isVerified: false,
      message: '',
      env: DEMO_MODE ? 'dev' : 'prod',
    }
  }

  async loginUser() {
    if (!this.msalInstance.getAccount()) {
      this.msalInstance.loginPopup(this.loginRequest)
        .then(async response => {
          this.setState({ isLoading: !this.state.isLoading })
          await this.getUserDetails()
        })
        .catch(err => {
          console.log(err)
        });
    }
    else {
      this.setState({ isLoading: !this.state.isLoading })
      await this.getUserDetails()
    }
  }

  async getUserDetails() {
    this.msalInstance.acquireTokenSilent({ scopes: [SCOPE] })
      .then(async response => {
        window.localStorage.setItem('Fw4_access_Token', response.accessToken)
        window.localStorage.setItem('Fw4_access_Token_exp', moment(response.expiresOn).format('YYYY-MM-DDTHH:mm:ss'))
        await this.getUserFromDB(response)
      })
      .catch(async err => {
        console.log('Silent token acquisition failed:', err)
        // Fallback to interactive token acquisition on timeout or other errors
        if (err.errorCode === 'token_renewal_error' || err.name === 'ClientAuthError') {
          try {
            const response = await this.msalInstance.acquireTokenPopup({ scopes: [SCOPE] })
            window.localStorage.setItem('Fw4_access_Token', response.accessToken)
            window.localStorage.setItem('Fw4_access_Token_exp', moment(response.expiresOn).format('YYYY-MM-DDTHH:mm:ss'))
            await this.getUserFromDB(response)
          } catch (popupErr) {
            console.log('Interactive token acquisition also failed:', popupErr)
            this.setState({ isVerified: false, isLoading: false, message: 'You dont have access to view this Application.Please Log out and try a valid Microsoft Account!'})
          }
        } else {
          console.log('Token acquisition failed:', err)
          this.setState({ isVerified: false, isLoading: false, message: 'You dont have access to view this Application.Please Log out and try a valid Microsoft Account!!' })
        }
      }
      );
  }

  async getUserFromDB(response) {
    axios.defaults.headers = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      "ACCESS-CONTROL-ALLOW-CREDENTIAL": true,
      'Authorization': 'Bearer ' + response.accessToken
    }

    let user = await axios.get(APIURL + '/auth', { params: { email: response.account.userName } })

    if (user.data.length === 0) {
      window.sessionStorage.clear()
      this.setState({
        isAuth: false, modal: true, isLoading: false, isVerified: false, message: 'You dont have access to view this Application.Please Log out and try a valid Microsoft Account!!!'
      })
    } else if (user.data.length === 1 && user.data[0].emp_type !== 'Admin' && user.data[0].com_id === 2000) {
      this.setState({ isAuth: false, isLoading: false, message: 'You dont have access to view this Application. Only Admins from Company \"ANALYTIQ INC\" on app.fieldworker.ai can view this site.', isVerified: false, modal: false })
    } else {
      this.setState({ isAuth: true, message: '', isVerified: true, modal: false, user: { ...this.state.user, isLoading: false, emp_id: user.data[0].emp_id, emp_name: user.data[0].emp_first_name + ' ' + user.data[0].emp_last_name, comp_id: user.data[0].emp_company_id, company_name: user.data[0].com_name, type: user.data[0].emp_type, emp_is_admin: user.data[0].emp_is_admin, accessToken: response.accessToken, email: response.account.userName, subs: user.data[0].subs, states: user.data[0].states } })
    }
  }

  async logoutUser() {
    window.localStorage.clear()
    this.msalInstance.logout()
  }

  async checkTokenExpiry(fromMount = false) {
    if (!!this.msalInstance.getAccount() && moment().isAfter(moment(window.localStorage.getItem('Fw4_access_Token_exp')).add(-1, 'm'))) {
      await this.getUserDetails()
    } else if (!!fromMount && !!this.msalInstance.getAccount() && moment().isBefore(moment(window.localStorage.getItem('Fw4_access_Token_exp')))) {
      await this.getUserFromDB({ accessToken: window.localStorage.getItem('Fw4_access_Token'), account: { userName: this.msalInstance.getAccount().userName } })
    } else {
    }
  }

  componentDidMount() {
    if (DEMO_MODE) return
    this.checkTokenExpiry(true)
  }

  handleENVToggle = (event, environment) => {
    if (environment !== null) {
      this.setState({ ...this.state, env: environment });
    }
  };

  render() {
    const { isAuth, user, env, isLoading, message } = this.state;
    const envColor = { dev: '#616161', test: '#ed6c02', prod: '#1976d2' }[env] || '#1976d2';

    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
        <Box
          component="header"
          sx={{
            display: 'grid',
            gridTemplateColumns: '1fr auto 1fr',
            alignItems: 'center',
            px: 2,
            py: 1,
            borderBottom: '1px solid',
            borderColor: 'divider',
            boxShadow: '0px 2px 4px rgba(0,0,0,0.08)',
            bgcolor: 'background.paper',
            zIndex: 1,
          }}
        >
          <Box sx={{ justifySelf: 'start' }}>
            {!!isAuth &&
              <ToggleButtonGroup
                color="primary"
                value={env}
                exclusive
                size="small"
                onChange={this.handleENVToggle}
              >
                {['dev', 'test', 'prod'].map(e => (
                  <ToggleButton
                    key={e}
                    value={e}
                    sx={{
                      px: 2,
                      fontWeight: 600,
                      '&.Mui-selected': {
                        backgroundColor: envColor,
                        color: '#fff',
                        '&:hover': { backgroundColor: envColor, filter: 'brightness(0.9)' },
                      },
                    }}
                  >
                    {e.toUpperCase()}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            }
          </Box>
          <Typography variant="h5" component="h1" sx={{ justifySelf: 'center', fontWeight: 600, m: 0 }}>
            Fieldworker MIS
          </Typography>
          <Box sx={{ justifySelf: 'end' }}>
            {!!isAuth && <UserMenu user={user} onLogout={this.logoutUser} />}
          </Box>
        </Box>

        {!!isAuth && <ToggleMIS env={env} user={user} />}

        {!isAuth && <LoginCard isLoading={isLoading} message={message} onLogin={this.loginUser} onLogout={this.logoutUser} />}
      </Box>
    );
  }
}

function UserMenu({ user, onLogout }) {
  const [anchorEl, setAnchorEl] = React.useState(null);
  const initials = (user.emp_name || user.email || '?')
    .split(' ')
    .map(w => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <>
      <IconButton onClick={(e) => setAnchorEl(e.currentTarget)} size="small" title={user.email}>
        <Avatar sx={{ width: 32, height: 32, fontSize: 14, bgcolor: 'primary.main' }}>{initials}</Avatar>
      </IconButton>
      <Menu anchorEl={anchorEl} open={!!anchorEl} onClose={() => setAnchorEl(null)}>
        <Box sx={{ px: 2, py: 1 }}>
          <Typography variant="subtitle2">{user.emp_name}</Typography>
          <Typography variant="caption" color="text.secondary">{user.email}</Typography>
        </Box>
        <Divider />
        <MenuItem onClick={() => { setAnchorEl(null); onLogout(); }}>
          <ListItemIcon><LogoutIcon fontSize="small" /></ListItemIcon>
          Log out
        </MenuItem>
      </Menu>
    </>
  );
}

function LoginCard({ isLoading, message, onLogin, onLogout }) {
  const hasStaleToken = !!window.localStorage.getItem('Fw4_access_Token');

  return (
    <Box
      sx={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        p: 2,
        // Same backdrop as the FWApp login page
        backgroundImage: 'url(./login_bg.jpg)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }}
    >
      <Paper elevation={0} sx={{ p: 5, width: '100%', maxWidth: 420, textAlign: 'center', borderRadius: 3, boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
        <img src="./FieldworkerIcon.png" alt="Fieldworker" style={{ width: 64, height: 64, marginBottom: 16 }} />
        <Typography variant="h5" sx={{ fontWeight: 600 }}>Fieldworker MIS</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 3 }}>
          Internal admin console. Sign in with your ANALYTIQ Microsoft account to continue.
        </Typography>

        <Button
          variant="contained"
          fullWidth
          size="large"
          disabled={isLoading}
          startIcon={isLoading ? <CircularProgress size={20} color="inherit" /> : <img style={{ width: 20, height: 20 }} src="./ms.png" alt="" />}
          onClick={onLogin}
        >
          {isLoading ? 'Signing in…' : 'Sign in with Microsoft'}
        </Button>

        {hasStaleToken &&
          <Button variant="text" color="inherit" fullWidth sx={{ mt: 1 }} onClick={onLogout}>
            Sign out of the current account
          </Button>
        }

        {message &&
          <Alert severity="error" sx={{ mt: 3, textAlign: 'left' }}>
            {message}
          </Alert>
        }
      </Paper>
    </Box>
  );
}

export default App;