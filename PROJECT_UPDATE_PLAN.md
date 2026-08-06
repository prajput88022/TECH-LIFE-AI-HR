# Tech-Life AI HR — Project Update Plan
## Tenant-Wise Configuration & Multi-Level Authorization

---

## Overview

This document outlines the transformation of TECH-LIFE-AI-HR from an environment-variable-based configuration system to a **fully tenant-centric, database-driven architecture** with:

- **Tenant-wise configuration** (no `.env` for vendor settings)
- **Hierarchical role-based access control (RBAC)** with fine-grained permissions
- **Dynamic vendor selection** per tenant (LLM, TTS, STT, SIP, call vendor)
- **Auto-interview optimization** with SIP provider selection
- **Promotion process automation** with hierarchical approval workflows

---

## Architecture Overview

### Current State
```
├─ .env (global secrets for ALL tenants)
├─ Integration Config (stored in CouchDB but vendor selection via .env)
└─ User Roles (HR, Management, Superadmin only)
```

### Target State
```
├─ .env (ONLY core secrets: JWT_SECRET, DB credentials, SMTP master)
├─ Tenant Config (Database-driven per tenant)
│  ├─ LLM Vendor Selection & API Key
│  ├─ TTS Vendor Selection & Settings (natural voice profiles)
│  ├─ STT Vendor Selection & Settings
│  ├─ Call Vendor Selection (Twilio/Asterisk/FreeSWITCH)
│  ├─ SIP Provider Selection (industry-specific)
│  └─ Feature Toggles & Industry-Specific Endpoints
├─ Hierarchical Authorization
│  ├─ SuperAdmin (platform-wide control)
│  ├─ TenantAdmin (full tenant control + vendor selection)
│  ├─ Admin (team/department control)
│  ├─ HR/Recruiter (candidate management + interview setup)
│  ├─ Interviewer/Agent (interview execution only)
│  └─ Candidate/Employee (self-service interview)
└─ Dynamic Endpoint Configuration (per tenant + industry)
```

---

## Phase 1: Database Schema & Tenant Configuration

### 1.1 New CouchDB Document Types

#### TenantConfig (Core Tenant Settings)
```javascript
{
  "_id": "tenantconfig:demo",
  "type": "tenantconfig",
  "tenant_id": "demo",
  "organization_name": "Demo Corporation",
  
  // ===== LLM Configuration =====
  "llm": {
    "vendor": "openai", // "anthropic", "custom", null
    "model": "gpt-4",
    "endpoint": "https://api.openai.com/v1",
    "timeout_ms": 30000,
    "max_tokens": 2000,
    "enabled": true
  },
  
  // ===== TTS Configuration (Natural Voice) =====
  "tts": {
    "vendor": "elevenlabs", // "azure", "google", "custom", "browser"
    "voice_profile": "professional_male", // Vendor-specific profile
    "language": "en-US",
    "speech_rate": 1.0,
    "natural_voice_enabled": true,
    "endpoint": "https://api.elevenlabs.io/v1",
    "timeout_ms": 5000,
    "enabled": true
  },
  
  // ===== STT Configuration (Speech-to-Text) =====
  "stt": {
    "vendor": "deepgram", // "google", "whisper", "custom", "browser"
    "model": "nova-2",
    "language": "en",
    "interim_results": true,
    "endpoint": "https://api.deepgram.com/v1",
    "timeout_ms": 10000,
    "enabled": true
  },
  
  // ===== Call Vendor Configuration =====
  "call_vendor": {
    "provider": "twilio", // "asterisk", "freeswitch"
    "type": "sip_trunk", // "cloud", "on-premise"
    
    // Twilio
    "twilio": {
      "account_sid": null, // Stored in secrets manager, not here
      "from_number": "+1234567890",
      "enabled": true
    },
    
    // Asterisk
    "asterisk": {
      "host": "pbx.company.com",
      "port": 5038,
      "context": "from-internal",
      "enabled": false
    },
    
    // FreeSWITCH
    "freeswitch": {
      "host": "fs.company.com",
      "port": 8021,
      "enabled": false
    }
  },
  
  // ===== SIP Provider Configuration =====
  "sip": {
    "provider": "asterisk_sip", // "kamailio", "opensips", "freeswitch_sip", "twilio"
    "enabled": true,
    
    // SIP Server Settings
    "sip_server": {
      "host": "sip.company.com",
      "port": 5060,
      "tls_port": 5061,
      "use_tls": true,
      "domain": "company.com",
      "realm": "company.com"
    },
    
    // Auto-Interview Optimization
    "auto_interview": {
      "enabled": true,
      "codec_preference": ["opus", "g722", "ulaw"],
      "max_call_duration_minutes": 60,
      "auto_recording": true,
      "dtmf_support": true
    },
    
    // Call Routing for Interviews
    "call_routing": {
      "incoming_route": "interview_queue",
      "hangup_on_silence": true,
      "silence_timeout_seconds": 30,
      "auto_answer_delay_ms": 1000
    }
  },
  
  // ===== Promotion Process Configuration =====
  "promotion_workflow": {
    "enabled": true,
    "approval_levels": [
      {
        "level": 1,
        "role": "HR",
        "description": "Initial screening review",
        "auto_approve_threshold": null
      },
      {
        "level": 2,
        "role": "Admin",
        "description": "Department head review",
        "auto_approve_threshold": null
      },
      {
        "level": 3,
        "role": "TenantAdmin",
        "description": "Executive approval",
        "auto_approve_threshold": 85 // Auto-approve if score > 85
      }
    ],
    "auto_routing": true,
    "notification_channels": ["email", "whatsapp", "in-app"],
    "sla_hours": 48
  },
  
  // ===== Industry-Specific Endpoints =====
  "industries": {
    "IT": {
      "enabled": true,
      "custom_questions_endpoint": "/api/industries/IT/questions",
      "skill_assessment_vendor": "custom", // For technical assessments
      "skill_assessment_endpoint": "https://assessments.company.com/api/it"
    },
    "BFSI": {
      "enabled": true,
      "custom_questions_endpoint": "/api/industries/BFSI/questions",
      "compliance_check_vendor": "custom",
      "compliance_endpoint": "https://compliance.company.com/verify"
    },
    // ... more industries
  },
  
  // ===== Feature Toggles =====
  "features": {
    "candidate_management": true,
    "ai_voice_interview": true,
    "telephony_calling": true,
    "pre_test_smart_form": true,
    "email_notifications": true,
    "whatsapp_notifications": true,
    "kpi_analytics": true,
    "reports_dashboard": true,
    "webhook_api": true,
    "auto_interview": true,
    "promotion_workflow": true,
    "custom_sip_provider": true
  },
  
  // ===== Webhook Configuration =====
  "webhooks": {
    "enabled": true,
    "urls": [],
    "secret": null, // Stored in secrets manager
    "events": ["candidate.created", "interview.completed", "decision.finalized"],
    "retry_policy": {
      "max_retries": 3,
      "backoff_seconds": 5
    }
  },
  
  "created_at": "2024-01-01T00:00:00Z",
  "updated_at": "2024-01-01T00:00:00Z",
  "created_by": "superadmin@techlife.ai",
  "version": 1
}
```

#### VendorSecret (Encrypted Credentials Storage)
```javascript
{
  "_id": "vendorsecret:demo:llm:openai",
  "type": "vendorsecret",
  "tenant_id": "demo",
  "vendor_category": "llm", // "tts", "stt", "call", "sip"
  "vendor_name": "openai",
  
  // Encrypted fields (encrypted at-rest in CouchDB)
  "encrypted_credentials": {
    "api_key": "<AES-256 encrypted>",
    "api_secret": null,
    "auth_token": null,
    "webhook_secret": null
  },
  
  "created_at": "2024-01-01T00:00:00Z",
  "updated_by": "superadmin@techlife.ai",
  "last_tested": "2024-01-01T00:00:00Z",
  "is_active": true
}
```

---

## Phase 2: Hierarchical Role-Based Access Control

### 2.1 Role Hierarchy & Permissions Matrix

```javascript
{
  "_id": "roledefinition:superadmin",
  "type": "roledefinition",
  "role_name": "superadmin",
  "level": 100, // Higher number = more power
  "description": "Platform administrator with full control",
  
  "permissions": {
    // Organization Management
    "org:create": true,
    "org:read_all": true,
    "org:update_all": true,
    "org:delete": true,
    
    // User Management (all levels)
    "user:create_any": true,
    "user:read_all": true,
    "user:update_any": true,
    "user:delete_any": true,
    
    // Vendor & Integration Management
    "vendor:manage_all_vendors": true,
    "vendor:add_industry_endpoints": true,
    "vendor:manage_sip_providers": true,
    
    // Tenant Configuration
    "tenant:read_all_config": true,
    "tenant:update_all_config": true,
    
    // Reports & Analytics
    "report:read_all": true,
    "report:export_all": true,
    
    // System Settings
    "system:audit_logs": true,
    "system:manage_secrets": true
  }
}
```

```javascript
{
  "_id": "roledefinition:tenant_admin",
  "type": "roledefinition",
  "role_name": "tenant_admin",
  "level": 80,
  "description": "Tenant owner - controls vendor selection, approval workflows, all tenant users",
  
  "permissions": {
    // User Management (within tenant only)
    "user:create_own_tenant": true,
    "user:read_own_tenant": true,
    "user:update_own_tenant": true,
    "user:delete_own_tenant": true,
    "user:manage_roles_own_tenant": true,
    
    // Vendor & LLM Configuration
    "vendor:select_llm": true,
    "vendor:select_tts": true,
    "vendor:select_stt": true,
    "vendor:select_call_provider": true,
    "vendor:select_sip_provider": true,
    "vendor:manage_credentials": true,
    "vendor:test_connection": true,
    
    // Industry Endpoints
    "industry:add_endpoints_own_tenant": true,
    "industry:manage_custom_questions": true,
    
    // Promotion Workflow Configuration
    "workflow:configure_approval_levels": true,
    "workflow:set_sla": true,
    "workflow:define_auto_approval_thresholds": true,
    
    // Tenant Configuration
    "tenant:read_own_config": true,
    "tenant:update_own_config": true,
    
    // Reports
    "report:read_own_tenant": true,
    "report:export_own_tenant": true,
    
    // Approvals
    "approval:approve_any_case": true // Can approve at any level
  }
}
```

```javascript
{
  "_id": "roledefinition:admin",
  "type": "roledefinition",
  "role_name": "admin",
  "level": 60,
  "description": "Department/Team lead - manages users, approves high-value cases, views analytics",
  
  "permissions": {
    // User Management (team members only)
    "user:create_own_team": true,
    "user:read_own_team": true,
    "user:update_own_team": true,
    
    // Candidate Management
    "candidate:create": true,
    "candidate:read_own_team": true,
    "candidate:update_own_team": true,
    
    // Interview Management
    "interview:schedule": true,
    "interview:conduct": true,
    "interview:takeover_ai": true,
    
    // Approvals (for high-level cases: VP, GM level)
    "approval:approve_senior_cases": true,
    
    // Reports
    "report:read_own_team": true,
    "report:export_own_team": true
  }
}
```

```javascript
{
  "_id": "roledefinition:hr",
  "type": "roledefinition",
  "role_name": "hr",
  "level": 40,
  "description": "HR Recruiter - creates candidates, schedules interviews, records decisions",
  
  "permissions": {
    // Candidate Management
    "candidate:create": true,
    "candidate:read_own": true,
    "candidate:update_own": true,
    "candidate:send_invite": true,
    
    // Interview Management
    "interview:schedule": true,
    "interview:conduct": true,
    "interview:take_over_from_ai": true,
    "interview:record_decision": true,
    "interview:send_result_email": true,
    
    // Approvals (for junior cases: IC, L1 level)
    "approval:approve_junior_cases": true,
    
    // Reports
    "report:read_own_team": true,
    "report:export": false
  }
}
```

```javascript
{
  "_id": "roledefinition:interviewer",
  "type": "roledefinition",
  "role_name": "interviewer",
  "level": 20,
  "description": "AI Agent / Human Interviewer - conducts interviews only",
  
  "permissions": {
    // Interview Conduction Only
    "interview:conduct": true,
    "interview:record_transcript": true,
    "interview:upload_recording": true,
    
    // Minimal Read
    "candidate:read_assigned": true
  }
}
```

```javascript
{
  "_id": "roledefinition:candidate",
  "type": "roledefinition",
  "role_name": "candidate",
  "level": 1,
  "description": "External candidate/employee - self-service interview and pre-test",
  
  "permissions": {
    // Self-Service Only
    "pretest:take": true,
    "interview:join": true,
    "interview:record_audio_video": true,
    "candidate:update_own_profile": true
  }
}
```

### 2.2 User Document with Role Assignment

```javascript
{
  "_id": "user:demo:tenantadmin_001",
  "type": "user",
  "tenant_id": "demo",
  "email": "admin@democorp.com",
  "full_name": "Rajesh Patel",
  
  // Primary Role
  "primary_role": "tenant_admin",
  
  // Multi-role Support (can have multiple roles)
  "roles": [
    {
      "role": "tenant_admin",
      "assigned_at": "2024-01-01T00:00:00Z",
      "assigned_by": "superadmin@techlife.ai",
      "scope": "tenant", // "tenant", "department", "team"
      "scope_id": "demo",
      "permissions_override": {
        // Tenant admin can override specific vendor selection
        "vendor:select_llm": true
      }
    }
  ],
  
  // Status
  "status": "active", // "active", "inactive", "pending", "suspended"
  "availability": "available", // "available", "busy", "offline"
  "last_login": "2024-01-15T10:30:00Z",
  
  // Audit
  "created_at": "2024-01-01T00:00:00Z",
  "created_by": "superadmin@techlife.ai",
  "updated_at": "2024-01-15T10:30:00Z"
}
```

---

## Phase 3: SIP Provider & Auto-Interview Setup

### 3.1 SIP Provider Configuration

```javascript
{
  "_id": "sipprovider:asterisk:demo",
  "type": "sipprovider",
  "tenant_id": "demo",
  "provider_type": "asterisk", // "freeswitch", "kamailio", "opensips", "twilio"
  
  // Asterisk-specific configuration
  "asterisk": {
    "ami_host": "pbx.company.com",
    "ami_port": 5038,
    "ami_username": "admin",
    "ami_secret": null, // In secrets store
    "sip_port": 5060,
    "tls_port": 5061,
    "use_tls": true,
    "context": "from-internal",
    "extension_range": "1000-1999"
  },
  
  // Call Features for Auto-Interview
  "auto_interview_features": {
    "call_recording": {
      "enabled": true,
      "format": "wav",
      "storage_path": "/recordings/interviews",
      "backup_location": "s3://bucket/backups"
    },
    
    "ivr_settings": {
      "enabled": true,
      "language": "en",
      "voice": "female",
      "greeting": "Welcome to the automated interview system",
      "max_silence_duration_seconds": 30,
      "dtmf_timeout_seconds": 5
    },
    
    "codec_settings": {
      "preferred_codecs": ["opus", "g722", "ulaw"],
      "transcoding_support": true,
      "bandwidth_optimization": true
    },
    
    "transfer_to_hr": {
      "enabled": true,
      "hr_queue": "interview_hr_queue",
      "max_wait_time_seconds": 300,
      "fallback_voicemail": true
    }
  },
  
  // Promotion Process SIP Routing
  "promotion_process": {
    "enabled": true,
    "escalation_queue": "promotion_escalations",
    "priority_routing": {
      "senior_level_candidates": "vip_queue",
      "fast_track_candidates": "priority_queue"
    },
    "conference_support": {
      "enabled": true,
      "max_participants": 5,
      "recording": true
    }
  },
  
  "is_active": true,
  "created_at": "2024-01-01T00:00:00Z",
  "tested_at": "2024-01-15T10:00:00Z",
  "test_status": "success"
}
```

### 3.2 Auto-Interview Call Flow

```
Candidate Accepts Invite
          ↓
    [SIP Gateway Bridges Call]
          ↓
    [Auto-Interview IVR Answers]
          ↓
    ┌─────────────────────────┬─────────────────┐
    │                         │                 │
    v                         v                 v
[HR Available?]         [Junior Level?]   [Senior Level?]
    │ Yes                   │ Yes                │ Yes
    ↓                       ↓                    ↓
[Transfer to HR]     [AI Interview]      [Queue for Manager]
    │                      │                    │
    ↓                      ↓                    ↓
[Human Interview]   [STT+LLM+TTS]        [Escalation Queue]
    │                      │                    │
    └──────────┬───────────┘                    │
               ↓                                ↓
         [End Interview]                 [Management Review]
               │                                │
               └────────────────┬───────────────┘
                                ↓
                         [Decision Recording]
                                │
                                ↓
                         [Result Email/SMS]
```

---

## Phase 4: Implementation Roadmap

### Phase 4.1: Database & Schema Updates

**Files to create:**
1. `src/migrations/001_tenant_config_schema.js` — CouchDB schema initialization
2. `src/schemas/tenantConfig.js` — Validation schemas
3. `src/db/tenantConfigQueries.js` — Database queries
4. `src/services/tenantConfigService.js` — Business logic

**Key functions:**
- `getTenantConfig(tenantId)` — Load full tenant configuration
- `updateTenantConfig(tenantId, updates)` — Update with change tracking
- `getVendorSecrets(tenantId, category)` — Retrieve encrypted credentials
- `testVendorConnection(tenantId, vendor, category)` — Connection testing

### Phase 4.2: Hierarchical Authorization System

**Files to create:**
1. `src/roles/roleDefinitions.js` — Role & permission catalog
2. `src/middleware/authz.js` — Enhanced authorization middleware
3. `src/services/rbacService.js` — Permission checking engine
4. `src/routes/rbacRoutes.js` — Role management API

**Key functions:**
- `checkPermission(user, permission, resource)` — Fine-grained checks
- `getRoleChain(userId)` — Get all effective permissions
- `createRole(tenantId, roleDefinition)` — Custom role creation
- `assignRoleToUser(userId, role, scope)` — Role assignment

### Phase 4.3: Vendor Management UI & API

**Files to create:**
1. `public/tenant-admin.html` — Tenant admin console
2. `src/routes/vendorRoutes.js` — Vendor API endpoints
3. `src/services/vendorIntegrationService.js` — Vendor-agnostic wrapper
4. `src/services/sip/sipProviderService.js` — SIP provider abstraction

**Key endpoints:**
- `POST /api/tenant/vendor/select` — Select vendor for category
- `POST /api/tenant/vendor/test-connection` — Test vendor credentials
- `GET /api/tenant/vendor/status` — Get all vendor statuses
- `POST /api/industries/:industry/endpoints` — Add industry endpoints
- `PUT /api/sip/auto-interview` — Configure auto-interview

### Phase 4.4: SIP & Auto-Interview Integration

**Files to create:**
1. `src/services/sip/asteriskService.js` — Asterisk integration
2. `src/services/sip/autoInterviewService.js` — Call flow orchestration
3. `src/services/sip/callRoutingService.js` — Intelligent routing
4. `tests/sip-auto-interview.test.js` — Integration tests

**Key functions:**
- `initiateAutoInterview(candidateId)` — Start SIP call
- `routeCallToHRIfAvailable(callId)` — Check availability & route
- `recordInterviewCall(callId)` — Start recording
- `triggerPromotionEscalation(employeeId, level)` — Escalation routing

### Phase 4.5: Promotion Workflow & Approvals

**Files to create:**
1. `src/services/promotion/approvalWorkflowService.js` — Workflow engine
2. `src/routes/promotionRoutes.js` — Promotion API
3. `public/promotion-workflow.html` — Approval UI
4. `src/services/notification/promotionNotifications.js` — Alert system

**Key functions:**
- `submitPromotionCase(employeeId, data)` — Create promotion case
- `getApprovalQueue(userId)` — Get pending approvals for user
- `recordApprovalDecision(caseId, decision, notes)` — Approve/reject
- `escalateCase(caseId, reason)` — Manual escalation
- `autoApproveIfThresholdMet(caseId, score)` — Auto-approval logic

---

## Phase 5: Environment Variables Update

### New .env (Minimal)
```dotenv
# ============================================================================
# Core Platform Configuration (ONLY global secrets go here now)
# ============================================================================

# Server
PORT=4000
NODE_ENV=production

# Database
COUCHDB_URL=
COUCHDB_HOST=localhost
COUCHDB_PORT=5984
COUCHDB_USER=admin
COUCHDB_PASSWORD=password
COUCHDB_DBNAME=techlifehr

# Core Security
JWT_SECRET=change-this-to-a-long-random-string-in-production
SUPERADMIN_EMAIL=superadmin@techlife.ai
SUPERADMIN_PASSWORD=SuperAdmin@123

# Master SMTP (for system emails only, tenant-specific in config)
SMTP_HOST=smtp.yourprovider.com
SMTP_PORT=587
SMTP_USER=system@techlife.ai
SMTP_PASSWORD=password

# Secrets Encryption (for storing vendor credentials securely)
SECRETS_ENCRYPTION_KEY=change-this-to-secure-random-key-32-chars-min

# ============================================================================
# DEPRECATED (Moved to tenant config):
# - LLM_PROVIDER, LLM_API_KEY
# - STT_PROVIDER, STT_API_KEY
# - TTS_PROVIDER, TTS_API_KEY
# - TELEPHONY_VENDOR, TWILIO_*, ASTERISK_*, FREESWITCH_*
# ============================================================================
```

---

## Phase 6: Migration Path

### Step 1: Dual-Mode Operation (Week 1)
- Deploy schema updates
- Seed initial TenantConfig documents from existing `.env`
- Keep `.env` working as fallback
- Log when legacy config is used

### Step 2: Gradual Migration (Week 2-3)
- Tenant admins migrate their config via new UI
- Background service syncs `.env` to TenantConfig
- Monitor for mismatches

### Step 3: Full Cutover (Week 4)
- Disable `.env` vendor loading
- Require all tenants to be on new system
- Archive old config for audit trail

---

## API Endpoints Summary

### Tenant Configuration
```
GET    /api/tenant/config                 → Get tenant config
PUT    /api/tenant/config                 → Update tenant config
POST   /api/tenant/config/validate        → Validate config
```

### Vendor Management
```
GET    /api/tenant/vendor/list            → List available vendors
POST   /api/tenant/vendor/select          → Select vendor
POST   /api/tenant/vendor/test-connection → Test credentials
DELETE /api/tenant/vendor/:vendor         → Disable vendor
```

### Industry Endpoints
```
GET    /api/industries/:id/endpoints      → Get industry endpoints
POST   /api/industries/:id/endpoints      → Add custom endpoint
PUT    /api/industries/:id/endpoints/:eid → Update endpoint
```

### Role & Authorization
```
GET    /api/roles                         → List all roles
GET    /api/users/:id/roles               → Get user roles
POST   /api/users/:id/assign-role         → Assign role
DELETE /api/users/:id/roles/:role         → Remove role
```

### SIP & Auto-Interview
```
GET    /api/sip/providers                 → List SIP providers
PUT    /api/sip/config                    → Update SIP config
POST   /api/sip/test-connection           → Test SIP connection
POST   /api/calls/:id/route-to-hr         → Intelligent routing
```

### Promotion Workflow
```
POST   /api/promotion/submit              → Create promotion case
GET    /api/promotion/approvals           → Pending approvals
PUT    /api/promotion/:id/approve         → Record approval
POST   /api/promotion/:id/escalate        → Escalate case
```

---

## Security Considerations

### Credential Management
- **Encryption at rest:** All vendor secrets encrypted with `SECRETS_ENCRYPTION_KEY`
- **Encryption in transit:** All credentials transmitted over TLS only
- **Audit logging:** Every credential access/modification logged
- **Rotation support:** Built-in credential rotation workflows

### Authorization
- **Zero-trust model:** Check permissions on every operation
- **Token scope:** JWT contains role + scope for efficient checks
- **Audit trail:** All permission changes logged with timestamp + actor
- **Session management:** Automatic logout on role change

### API Security
- **Rate limiting:** Per-tenant, per-user rate limits
- **CORS:** Tenant-specific CORS policies
- **Webhook signing:** HMAC-SHA256 on all outbound webhooks
- **IP whitelisting:** Optional per-vendor

---

## Testing Strategy

### Unit Tests
- Role permission matrix validation
- Vendor config schema validation
- SIP call routing logic

### Integration Tests
- End-to-end SIP call flow
- Vendor connection testing
- Promotion workflow approvals

### Load Tests
- Multi-tenant config updates
- Concurrent auto-interviews
- Approval queue processing

---

## Success Metrics

1. ✅ All vendor config stored in database (zero `.env` vendor vars)
2. ✅ 6+ role levels with granular permissions
3. ✅ Tenant admins can select any vendor combo
4. ✅ Auto-interview calls complete in < 2 seconds after SIP connection
5. ✅ Promotion cases auto-route through approval hierarchy
6. ✅ 100% encrypted credential storage
7. ✅ Audit trail 100% complete for all changes

---

## Timeline

| Phase | Duration | Key Deliverable |
|-------|----------|-----------------|
| 1 | Week 1-2 | Schema + migrations + tests |
| 2 | Week 2-3 | RBAC middleware + UI |
| 3 | Week 3-4 | Vendor management UI |
| 4 | Week 4-5 | SIP + auto-interview |
| 5 | Week 5-6 | Promotion workflow |
| 6 | Week 6-8 | Migration + cutover |

**Total: 8 weeks for full implementation**

---

## Questions & Support

For questions about this plan, refer to:
- `ARCHITECTURE.md` — Detailed technical architecture
- `VENDOR_GUIDE.md` — Vendor-specific implementation guides
- `RBAC_GUIDE.md` — Authorization system deep dive
- `SIP_GUIDE.md` — SIP provider setup & troubleshooting

