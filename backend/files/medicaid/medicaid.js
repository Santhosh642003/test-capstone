exports.generateMedicaidJson = function (payload) {
  const { customerData, companyData, taskData, claimAmount, procedureCode } = payload
  var submitterID = '9904999'
  
  // getting current date and time
  var moment = require('moment-timezone');
  var formattedTime = moment().tz("America/New_York")
  var currentDate = formattedTime.format("YYYYMMDD")
  var currentTime = formattedTime.format("hhmm")

  var medicaidJson = {
    SegmentDelimiter: '~',
    DataElementDelimiter: '*',
    ISA: {
      AuthorizationInformationQualifier_1: '03',
      AuthorizationInformation_2: submitterID + '   ', 
      SecurityInformationQualifier_3: '00',
      SecurityInformation_4: 'NONE      ',
      SenderIDQualifier_5: 'ZZ',
      InterchangeSenderID_6: submitterID + '        ', // ?
      ReceiverIDQualifier_7: 'ZZ',
      InterchangeReceiverID_8: '610515         ',
      InterchangeDate_9: currentDate,
      InterchangeTime_10: currentTime,
      InterchangeControlStandardsIdentifier_11: '^',
      InterchangeControlVersionNumber_12: '00501',
      InterchangeControlNumber_13: 'CN',
      AcknowledgementRequested_14: '1',
      UsageIndicator_15: 'P',
      ComponentElementSeparator_16: ':'
    },
    Groups: [
      {
        GS: {
          CodeIdentifyingInformationType_1: 'HC',
          SenderIDCode_2: submitterID,
          ReceiverIDCode_3: '610515',
          Date_4: currentDate,
          Time_5: currentTime,
          GroupControlNumber_6: 'CN',
          TransactionTypeCode_7: 'X',
          VersionAndRelease_8: '005010X222A1'
        },
        Transactions: [
          {
            ST: {
              TransactionSetIdentifierCode_01: '837',
              TransactionSetControlNumber_02: 'CN',
              ImplementationConventionPreference_03: '005010X222A1'
            },
            BHT_BeginningOfHierarchicalTransaction: { // ?
              HierarchicalStructureCode_01: '0019',
              TransactionSetPurposeCode_02: '00',
              SubmitterTransactionIdentifier_03: 'CN',
              TransactionSetCreationDate_04: currentDate,
              TransactionSetCreationTime_05: currentTime,
              TransactionTypeCode_06: 'RP'
            },
            AllNM1: {
              Loop1000A: {
                NM1_SubmitterName: {
                  EntityIdentifierCode_01: '41',
                  EntityTypeQualifier_02: '2',
                  ResponseContactLastorOrganizationName_03: 'Fieldworker.AI',
                  ResponseContactFirstName_04: '',
                  ResponseContactMiddleName_05: '',
                  NamePrefix_06: '',
                  ResponseContactNameSuffix_07: '',
                  IdentificationCodeQualifier_08: '46',
                  ResponseContactIdentifier_09: submitterID // NTK (Submitter ID assigned by New Jersey Medicaid for fieldworker.)
                },
                PER_SubmitterEDIContactInformation: [
                  {
                    ContactFunctionCode_01: 'IC',
                    ResponseContactName_02: 'Prabhat',
                    CommunicationNumberQualifier_03: 'TE',
                    ResponseContactCommunicationNumber_04: '6097201414',
                    CommunicationNumberQualifier_05: 'EX',
                    ResponseContactCommunicationNumber_06: '1'
                  }
                ]
              },
              Loop1000B: {
                NM1_ReceiverName: {
                  EntityIdentifierCode_01: '40',
                  EntityTypeQualifier_02: '2',
                  ResponseContactLastorOrganizationName_03: 'NEW JERSEY MEDICAID',
                  ResponseContactFirstName_04: '',
                  ResponseContactMiddleName_05: '',
                  NamePrefix_06: '',
                  ResponseContactNameSuffix_07: '',
                  IdentificationCodeQualifier_08: '46',
                  ResponseContactIdentifier_09: '610515'
                }
              }
            },
            Loop2000A: [
              {
                HL_BillingProviderHierarchicalLevel: {
                  HierarchicalIDNumber_01: '1',
                  HierarchicalParentIDNumber_02: '',
                  HierarchicalLevelCode_03: '20',
                  HierarchicalChildCode_04: '1'
                },
                PRV_BillingProviderSpecialtyInformation: { // ?
                  ProviderCode_01: 'BI',
                  ReferenceIdentificationQualifier_02: 'PXC',
                  ProviderTaxonomyCode_03: procedureCode // NTK TaxonomyCode for company A valid HIPAA taxonomy code is required on all FFS and CCP claims.
                },
                AllNM1: {
                  Loop2010AA: {
                    NM1_BillingProviderName: { // ?
                      EntityIdentifierCode_01: '85',
                      EntityTypeQualifier_02: '2',
                      ResponseContactLastorOrganizationName_03: companyData.companyName,
                      ResponseContactFirstName_04: '', // S
                      ResponseContactMiddleName_05: '', // S
                      NamePrefix_06: '', // NR
                      ResponseContactNameSuffix_07: '', // S
                      IdentificationCodeQualifier_08: 'XX', // S
                      ResponseContactIdentifier_09: '' // S => NPI of company
                    },
                    N3_BillingProviderAddress: {
                      ResponseContactAddressLine_01: companyData?.address
                    },
                    N4_BillingProviderCity_State_ZIPCode: {
                      AdditionalPatientInformationContactCityName_01: companyData?.city,
                      AdditionalPatientInformationContactStateCode_02: companyData?.state,
                      AdditionalPatientInformationContactPostalZoneorZIPCode_03: companyData?.zip
                    },
                    AllREF: {
                      REF_BillingProviderTaxIdentification: {
                        ReferenceIdentificationQualifier: 'EI', // R
                        MemberGrouporPolicyNumber_02: companyData.companyTaxID
                      }
                    }
                  },

                  // Loop2010AB: { // ?
                  //   NM1_Pay_AddressName: {
                  //     EntityIdentifierCode_01: '87',
                  //     EntityTypeQualifier_02: '2',
                  //     ResponseContactLastorOrganizationName_03: companyData?.address
                  //   },
                  //   N3_Pay_ToAddress_ADDRESS: {
                  //     ResponseContactAddressLine_01: companyData.companyName
                  //   },
                  //   N4_Pay_AddressCity_State_ZIPCode: {
                  //     AdditionalPatientInformationContactCityName_01: companyData?.city,
                  //     AdditionalPatientInformationContactStateCode_02: companyData?.state,
                  //     AdditionalPatientInformationContactPostalZoneorZIPCode_03: companyData?.zip
                  //   }
                  // }
                },
                Loop2000B: [ 
                  {
                    HL_SubscriberHierarchicalLevel: {
                      HierarchicalIDNumber_01: '2',
                      HierarchicalParentIDNumber_02: '1',
                      HierarchicalLevelCode_03: '22',
                      HierarchicalChildCode_04: '0'
                    },
                    SBR_SubscriberInformation: {
                      PayerResponsibilitySequenceNumberCode_01: 'P',
                      IndividualRelationshipCode_02: '', // S
                      InsuredGrouporPolicyNumber_03: '', // S
                      OtherInsuredGroupName: '', // S
                      InsuranceTypeCode: '', // S
                      CoordinationofBenefitsCode: '', // NR
                      YesNoConditionorResponseCode: '', // NR
                      EmploymentStatusCode: '', // NR
                      ClaimFilingIndicatorCode: 'MC'

                    },
                    AllNM1: {
                      Loop2010BA: {
                        NM1_SubscriberName: {
                          EntityIdentifierCode_01: 'IL',
                          EntityTypeQualifier_02: '1',
                          ResponseContactLastorOrganizationName_03: customerData.subscriberLastName,
                          ResponseContactFirstName_04: customerData.subscriberFirstName
                        },
                        DMG_SubscriberDemographicInformation: {
                          DateTimePeriodFormatQualifier_01: 'D8',
                          DependentBirthDate_02: customerData.subscriberDOB,
                          DependentGenderCode_03: customerData.subscriberGender
                        }
                      },
                      Loop2010BB: {
                        NM1_PayerName: {
                          EntityIdentifierCode_01: 'PR',
                          EntityTypeQualifier_02: '2',
                          ResponseContactLastorOrganizationName_03: 'NEW JERSEY MEDICAID',
                          ResponseContactFirstName: '', // NR
                          ResponseContactMiddleName: '', // NR
                          NamePrefix: '', // NR
                          ResponseContactNameSuffix: '', // NR
                          IdentificationCodeQualifier_08: 'PI',
                          ResponseContactIdentifier_09: '610515'
                        }
                      }
                    },
                    Loop2000C: [
                      {
                        Loop2300: [
                          {
                            CLM_ClaimInformation: {
                              PatientControlNumber_01: String(customerData.customerId),
                              TotalClaimChargeAmount_02: claimAmount.amount, // total claim amount
                              ClaimFilingIndicatorCode_03: '', // NR
                              NonInstitutionalClaimTypeCode_04: '', // NR
                              HealthCareServiceLocationInformation_05: {
                                FacilityTypeCode_01: '99',
                                FacilityCodeQualifier_02: 'B',
                                ClaimFrequencyTypeCode_03: '1'
                              },
                              ProviderorSupplierSignatureIndicator_06: 'Y',
                              AssignmentorPlanParticipationCode_07: 'A',
                              BenefitsAssignmentCertificationIndicator_08: 'Y',
                              ReleaseofInformationCode_09: 'I'
                            },
                            AllHI: {
                              HI_HealthCareDiagnosisCode: {
                                HealthCareCodeInformation_01: {
                                  CodeListQualifierCode_01: 'ABK',
                                  IndustryCode_02: 'ICD-10'
                                }
                              }
                            },
                            Loop2400: [
                              {
                                LX_ServiceLineNumber: {
                                  AssignedNumber_01: '1'
                                },
                                SV1_ProfessionalService: {
                                  CompositeMedicalProcedureIdentifier_01: {
                                    ProductorServiceIDQualifier_01: 'HC',
                                    ProcedureCode_02: procedureCode // ?
                                  },
                                  LineItemChargeAmount_02: claimAmount.amount, // amount
                                  UnitorBasisforMeasurementCode_03: 'UN', // R
                                  ServiceUnitCount_04: claimAmount.units, // R 
                                  PlaceofServiceCode_05: '99', // S
                                  ServiceTypeCode_06: '', // NR
                                  CompositeDiagnosisCodePointer_07: {
                                    DiagnosisCodePointer_01: ' '
                                  }
                                },
                                AllDTP: {
                                  DTP_Date_ServiceDate: {
                                    DateTimeQualifier_01: '472',
                                    DateTimePeriodFormatQualifier_02: 'D8',
                                    DateTimePeriod_03: taskData.taskDOS
                                  }
                                }
                              }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ],
            SE: {
              NumberofIncludedSegments_01: '39',
              TransactionSetControlNumber_02: 'CN'
            },
            Model: 'EdiNation.X12.HIPAA.005010.Base'
          }
        ],
        GETrailers: [
          {
            NumberOfIncludedSets_1: '1',
            GroupControlNumber_2: 'CN'
          }
        ]
      }
    ],
    IEATrailers: [
      {
        NumberOfIncludedGroups_1: '1',
        InterchangeControlNumber_2: 'CN'
      }
    ]
  }

  var medicaidArizonaJson = {
    SegmentDelimiter: '~',
    DataElementDelimiter: '*',
    ISA: {
      AuthorizationInformationQualifier_1: '00',
      AuthorizationInformation_2: '          ', 
      SecurityInformationQualifier_3: '00',
      SecurityInformation_4: '          ',
      SenderIDQualifier_5: 'ZZ',
      InterchangeSenderID_6: '', // Use Sender ID found in Providers → Provider ID Numbers Left justify and then follow with spaces until total character count is 15 
      ReceiverIDQualifier_7: 'ZZ',
      InterchangeReceiverID_8: 'HAR_837_Upload ',
      InterchangeDate_9: currentDate, // YYMMDD
      InterchangeTime_10: currentTime, // HHMM
      InterchangeControlStandardsIdentifier_11: '^',
      InterchangeControlVersionNumber_12: '00501',
      InterchangeControlNumber_13: 'CN',
      AcknowledgementRequested_14: '1',
      UsageIndicator_15: 'P',
      ComponentElementSeparator_16: ':'
    },
    Groups: [
      {
        GS: {
          CodeIdentifyingInformationType_1: 'HC',
          SenderIDCode_2: submitterID, // Use Sender ID found in Providers → Provider ID Numbers
          ReceiverIDCode_3: 'HAR_837_Upload', 
          Date_4: currentDate, // CCYYMMDD
          Time_5: currentTime, // HHMM
          GroupControlNumber_6: 'CN', // Must be between 1 and 9 digits
          TransactionTypeCode_7: 'X', 
          VersionAndRelease_8: '005010X222A1'
        },
        Transactions: [
          {
            ST: {
              TransactionSetIdentifierCode_01: '837',
              TransactionSetControlNumber_02: 'CN', // Must be between 4 and 9 characters in length
              ImplementationConventionPreference_03: '005010X222A1'
            },
            BHT_BeginningOfHierarchicalTransaction: { // ?
              HierarchicalStructureCode_01: '0019',
              TransactionSetPurposeCode_02: '00',
              SubmitterTransactionIdentifier_03: 'CN', // Must be between 1 and 30 characters
              TransactionSetCreationDate_04: currentDate, // CCYYMMDD
              TransactionSetCreationTime_05: currentTime, // HHMM
              TransactionTypeCode_06: 'CH'
            },
            AllNM1: {
              Loop1000A: {
                NM1_SubmitterName: {
                  EntityIdentifierCode_01: '41',
                  EntityTypeQualifier_02: '2',
                  ResponseContactLastorOrganizationName_03: 'Fieldworker.AI',
                  ResponseContactFirstName_04: '',
                  ResponseContactMiddleName_05: '',
                  NamePrefix_06: '',
                  ResponseContactNameSuffix_07: '',
                  IdentificationCodeQualifier_08: '46',
                  ResponseContactIdentifier_09: submitterID // Use Sender ID found in Providers → Provider ID Numbers
                },
                PER_SubmitterEDIContactInformation: [
                  {
                    ContactFunctionCode_01: 'IC',
                    ResponseContactName_02: 'Prabhat', // Avoid special characters if possible (e.g., O’Shea should be sent as OShea).
                    CommunicationNumberQualifier_03: 'EM',
                    ResponseContactCommunicationNumber_04: 'prabhat@analytiq.us', // email address
                    CommunicationNumberQualifier_05: '',
                    ResponseContactCommunicationNumber_06: '',
                    CommunicationNumberQualifier_07: 'TE',
                    ResponseContactCommunicationNumber_08: '5513122587', // without dashes
                  }
                ]
              },
              Loop1000B: {
                NM1_ReceiverName: {
                  EntityIdentifierCode_01: '40', 
                  EntityTypeQualifier_02: '2',
                  ResponseContactLastorOrganizationName_03: 'HAR_837_Upload',
                  ResponseContactFirstName_04: '',
                  ResponseContactMiddleName_05: '',
                  NamePrefix_06: '',
                  ResponseContactNameSuffix_07: '',
                  IdentificationCodeQualifier_08: '46',
                  ResponseContactIdentifier_09: 'HAR_837_Upload'
                }
              }
            },
            Loop2000A: [
              {
                HL_BillingProviderHierarchicalLevel: {
                  HierarchicalIDNumber_01: '1', // see TR3 guide for information on how to assign appropriate values
                  HierarchicalParentIDNumber_02: '',
                  HierarchicalLevelCode_03: '20',
                  HierarchicalChildCode_04: '1'
                },
                AllNM1: {
                  Loop2010AA: {
                    NM1_BillingProviderName: { // ?
                      EntityIdentifierCode_01: '85',
                      EntityTypeQualifier_02: '2',
                      ResponseContactLastorOrganizationName_03: companyData.companyName,
                      ResponseContactFirstName_04: '', // S
                      ResponseContactMiddleName_05: '', // S
                      NamePrefix_06: '', // NR
                      ResponseContactNameSuffix_07: '', // S
                      IdentificationCodeQualifier_08: 'XX', // If XX then send NPI, otherwise don't send XX leave this empty
                      ResponseContactIdentifier_09: companyData.npi // S => NPI of company
                    },
                    N3_BillingProviderAddress: {
                      ResponseContactAddressLine_01: companyData?.address
                    },
                    N4_BillingProviderCity_State_ZIPCode: {
                      AdditionalPatientInformationContactCityName_01: companyData?.city,
                      AdditionalPatientInformationContactStateCode_02: companyData?.state,
                      AdditionalPatientInformationContactPostalZoneorZIPCode_03: companyData?.zip
                    },
                    AllREF: {
                      REF_BillingProviderTaxIdentification: {
                        ReferenceIdentificationQualifier: 'EI', // R
                        MemberGrouporPolicyNumber_02: companyData.companyTaxID // Use/must match value in the Providers > Edit Provider > EIN/SSN field in WellSky Human Services
                      }
                    }
                  },

                  // Loop2010AB: { // ?
                  //   NM1_Pay_AddressName: {
                  //     EntityIdentifierCode_01: '87',
                  //     EntityTypeQualifier_02: '2',
                  //     ResponseContactLastorOrganizationName_03: companyData?.address
                  //   },
                  //   N3_Pay_ToAddress_ADDRESS: {
                  //     ResponseContactAddressLine_01: companyData.companyName
                  //   },
                  //   N4_Pay_AddressCity_State_ZIPCode: {
                  //     AdditionalPatientInformationContactCityName_01: companyData?.city,
                  //     AdditionalPatientInformationContactStateCode_02: companyData?.state,
                  //     AdditionalPatientInformationContactPostalZoneorZIPCode_03: companyData?.zip
                  //   }
                  // }
                },
                Loop2000B: [ 
                  {
                    HL_SubscriberHierarchicalLevel: {
                      HierarchicalIDNumber_01: '2',
                      HierarchicalParentIDNumber_02: '1',
                      HierarchicalLevelCode_03: '22',
                      HierarchicalChildCode_04: '0'
                    },
                    SBR_SubscriberInformation: {
                      PayerResponsibilitySequenceNumberCode_01: 'P',
                      IndividualRelationshipCode_02: '18', // S
                      InsuredGrouporPolicyNumber_03: '', // S
                      OtherInsuredGroupName: '', // S
                      InsuranceTypeCode: '', // S
                      CoordinationofBenefitsCode: '', // NR
                      YesNoConditionorResponseCode: '', // NR
                      EmploymentStatusCode: '', // NR
                      ClaimFilingIndicatorCode: 'ZZ'

                    },
                    AllNM1: {
                      Loop2010BA: {
                        NM1_SubscriberName: {
                          EntityIdentifierCode_01: 'IL',
                          EntityTypeQualifier_02: '1',
                          ResponseContactLastorOrganizationName_03: customerData.subscriberLastName,
                          ResponseContactFirstName_04: customerData.subscriberFirstName,
                          MiddleName_05: '', //NR
                          Prefix_06: '', //NR
                          Suffix_07: '', //NR
                          IdentificationCodeQualifier_08: 'MI', 
                          IdenficationCode_09: 'AHCCCS ID' // AHCCCS ID 
                        },
                        N3_SubscriberAddress: {
                          ResponseContactAddressLine_01: 'Address Line 1' // Subscriber Address
                        },
                        N4_BillingProviderCity_State_ZIPCode: {
                          AdditionalPatientInformationContactCityName_01: 'City', // Subscriber City
                          AdditionalPatientInformationContactStateCode_02: 'AZ', // State Code
                          AdditionalPatientInformationContactPostalZoneorZIPCode_03: '9 digit zip', // 9 digit zip without dashes 
                        },
                        DMG_SubscriberDemographicInformation: {
                          DateTimePeriodFormatQualifier_01: 'D8',
                          DependentBirthDate_02: customerData.subscriberDOB, 
                          DependentGenderCode_03: customerData.subscriberGender // F,M,U
                        }
                      },
                      Loop2010BB: {
                        NM1_PayerName: {
                          EntityIdentifierCode_01: 'PR',
                          EntityTypeQualifier_02: '2',
                          ResponseContactLastorOrganizationName_03: 'AZDESDDD',
                          ResponseContactFirstName: '', // NR
                          ResponseContactMiddleName: '', // NR
                          NamePrefix: '', // NR
                          ResponseContactNameSuffix: '', // NR
                          IdentificationCodeQualifier_08: 'PI',
                          ResponseContactIdentifier_09: '866004791'
                        },
                        REF_ProviderSecondaryIdentification : { // situational
                          ReferenceIdentificationQualifier_01: 'G2',
                          ReferenceIdentification_02: '' // Provider AHCCCS ID
                        }
                      }
                    },
                    Loop2000C: [
                      {
                        Loop2300: [
                          {
                            CLM_ClaimInformation: {
                              PatientControlNumber_01: String(customerData.customerId), // Defined by sender. Blank and zero (0) value not accepted
                              TotalClaimChargeAmount_02: claimAmount.amount, // total claim amount
                              ClaimFilingIndicatorCode_03: '', // NR
                              NonInstitutionalClaimTypeCode_04: '', // NR
                              HealthCareServiceLocationInformation_05: {
                                FacilityTypeCode_01: '99', // See Appendix A. Standard Place of Service Codes for allowable codes
                                FacilityCodeQualifier_02: 'B', 
                                ClaimFrequencyTypeCode_03: '1'
                              },
                              ProviderorSupplierSignatureIndicator_06: 'Y',
                              AssignmentorPlanParticipationCode_07: 'A',
                              BenefitsAssignmentCertificationIndicator_08: 'Y',
                              ReleaseofInformationCode_09: 'Y'
                            },
                            AllREF: {
                              REF_ClaimPriorAuthorization: {
                                ReferenceIdentificationQualifier_01: 'G1',
                                ReferenceIdentification_02: 'auth id' // WellSky Authorization ID
                              }
                            },
                            AllHI: {
                              HI_HealthCareDiagnosisCode: {
                              }
                            },
                            Loop2400: [
                              {
                                LX_ServiceLineNumber: {
                                  AssignedNumber_01: '1'
                                },
                                SV1_ProfessionalService: {
                                  CompositeMedicalProcedureIdentifier_01: {
                                    ProductorServiceIDQualifier_01: 'HC',
                                    ProcedureCode_02: procedureCode // ?
                                  },
                                  LineItemChargeAmount_02: claimAmount.amount, // amount
                                  UnitorBasisforMeasurementCode_03: 'UN', // R
                                  ServiceUnitCount_04: claimAmount.units, // R 
                                  PlaceofServiceCode_05: '', // S
                                  ServiceTypeCode_06: '', // NR
                                  CompositeDiagnosisCodePointer_07: {
                                    DiagnosisCodePointer_01: '1'
                                  }
                                },
                                AllDTP: {
                                  DTP_Date_ServiceDate: {
                                    DateTimeQualifier_01: '472',
                                    DateTimePeriodFormatQualifier_02: 'RD8',
                                    DateTimePeriod_03: taskData.taskDOS
                                  }
                                }
                              }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ],
            SE: {
              NumberofIncludedSegments_01: '39',
              TransactionSetControlNumber_02: 'CN'
            },
            Model: 'EdiNation.X12.HIPAA.005010.Base'
          }
        ],
        GETrailers: [
          {
            NumberOfIncludedSets_1: '1',
            GroupControlNumber_2: 'CN'
          }
        ]
      }
    ],
    IEATrailers: [
      {
        NumberOfIncludedGroups_1: '1',
        InterchangeControlNumber_2: 'CN'
      }
    ]
  }

  // setNumOfSegments(medicaidJson[Groups][0][Transactions])

  return medicaidJson
}

exports.generateTransactionObj = function (payload) {

  var moment = require('moment-timezone');
  var formattedTime = moment().tz("America/New_York")
  var currentDate = formattedTime.format("YYYYMMDD")
  var currentTime = formattedTime.format("hhmm")
  var allDiagnosisCodes = payload.customerData.ICD_10.split("/")

  let res = {
    ST: {
      TransactionSetIdentifierCode_01: '837',
      TransactionSetControlNumber_02: payload.customerData.controlNumber,
      ImplementationConventionPreference_03: '005010X222A1'
    },
    BHT_BeginningOfHierarchicalTransaction: { 
      HierarchicalStructureCode_01: '0019',
      TransactionSetPurposeCode_02: '00',
      SubmitterTransactionIdentifier_03: '00091TaskID',
      TransactionSetCreationDate_04: currentDate,
      TransactionSetCreationTime_05: currentTime,
      TransactionTypeCode_06: 'RP'
    },
    AllNM1: {
      Loop1000A: {
        NM1_SubmitterName: {
          EntityIdentifierCode_01: '41',
          EntityTypeQualifier_02: '2',
          ResponseContactLastorOrganizationName_03: payload.billingData.submitterName,
          ResponseContactFirstName_04: '',
          ResponseContactMiddleName_05: '',
          NamePrefix_06: '',
          ResponseContactNameSuffix_07: '',
          IdentificationCodeQualifier_08: '46',
          ResponseContactIdentifier_09: payload.billingData.submitterID // NTK (Submitter ID assigned by New Jersey Medicaid for fieldworker.)
        },
        PER_SubmitterEDIContactInformation: [
          {
            ContactFunctionCode_01: 'IC',
            ResponseContactName_02: 'Prabhat',
            CommunicationNumberQualifier_03: 'TE',
            ResponseContactCommunicationNumber_04: '6097201414',
            CommunicationNumberQualifier_05: 'EX',
            ResponseContactCommunicationNumber_06: '1'
          }
        ]
      },
      Loop1000B: {
        NM1_ReceiverName: {
          EntityIdentifierCode_01: '40',
          EntityTypeQualifier_02: '2',
          ResponseContactLastorOrganizationName_03: payload.billingData.receiverAgencyName,
          ResponseContactFirstName_04: '',
          ResponseContactMiddleName_05: '',
          NamePrefix_06: '',
          ResponseContactNameSuffix_07: '',
          IdentificationCodeQualifier_08: '46',
          ResponseContactIdentifier_09: payload.billingData.receiverID
        }
      }
    },
    Loop2000A: [
      {
        HL_BillingProviderHierarchicalLevel: {
          HierarchicalIDNumber_01: '1',
          HierarchicalParentIDNumber_02: '',
          HierarchicalLevelCode_03: '20',
          HierarchicalChildCode_04: '1'
        },
        PRV_BillingProviderSpecialtyInformation: { // ?
          ProviderCode_01: 'BI',
          ReferenceIdentificationQualifier_02: 'PXC',
          ProviderTaxonomyCode_03: payload.companyData.taxonomyCode // NTK TaxonomyCode for company A valid HIPAA taxonomy code is required on all FFS and CCP claims.
        },
        AllNM1: {
          Loop2010AA: {
            NM1_BillingProviderName: { // ?
              EntityIdentifierCode_01: '85',
              EntityTypeQualifier_02: '2',
              ResponseContactLastorOrganizationName_03: payload.companyData.companyName,
              ResponseContactFirstName_04: '', // S
              ResponseContactMiddleName_05: '', // S
              NamePrefix_06: '', // NR
              ResponseContactNameSuffix_07: '', // S
              IdentificationCodeQualifier_08: 'XX', // S
              ResponseContactIdentifier_09: payload.companyData.npi // S => NPI of company
            },
            N3_BillingProviderAddress: {
              ResponseContactAddressLine_01: payload.companyData?.address
            },
            N4_BillingProviderCity_State_ZIPCode: {
              AdditionalPatientInformationContactCityName_01: payload.companyData?.city,
              AdditionalPatientInformationContactStateCode_02: payload.companyData?.state,
              AdditionalPatientInformationContactPostalZoneorZIPCode_03: payload.companyData?.zip 
            },
            AllREF: {
              REF_BillingProviderTaxIdentification: {
                ReferenceIdentificationQualifier: 'EI', // R
                MemberGrouporPolicyNumber_02: payload.companyData.companyTaxID
              }
            }
          },
        },
        Loop2000B: [ 
          {
            HL_SubscriberHierarchicalLevel: {
              HierarchicalIDNumber_01: '2',
              HierarchicalParentIDNumber_02: '1',
              HierarchicalLevelCode_03: '22',
              HierarchicalChildCode_04: '0'
            },
            SBR_SubscriberInformation: {
              PayerResponsibilitySequenceNumberCode_01: 'P',
              IndividualRelationshipCode_02: payload.customerData.relationship ? payload.customerData.relationship : '18', // S
              InsuredGrouporPolicyNumber_03: '', // S
              OtherInsuredGroupName: '', // S
              InsuranceTypeCode: '', // S
              CoordinationofBenefitsCode: '', // NR
              YesNoConditionorResponseCode: '', // NR
              EmploymentStatusCode: '', // NR
              ClaimFilingIndicatorCode: 'MC'

            },
            AllNM1: {
              Loop2010BA: {
                NM1_SubscriberName: {
                  EntityIdentifierCode_01: 'IL',
                  EntityTypeQualifier_02: '1',
                  ResponseContactLastorOrganizationName_03: payload.customerData.subscriberLastName,
                  ResponseContactFirstName_04: payload.customerData.subscriberFirstName,
                  MiddleName_05: '', //NR
                  Prefix_06: '', //NR
                  Suffix_07: '', //NR
                  IdentificationCodeQualifier_08: 'MI', //NR
                  IdenficationCode_09: payload.customerData.medicaidID //?
                },
                DMG_SubscriberDemographicInformation: {
                  DateTimePeriodFormatQualifier_01: 'D8',
                  DependentBirthDate_02: payload.customerData.subscriberDOB,
                  DependentGenderCode_03: payload.customerData.subscriberGender
                }
              },
              Loop2010BB: {
                NM1_PayerName: {
                  EntityIdentifierCode_01: 'PR',
                  EntityTypeQualifier_02: '2',
                  ResponseContactLastorOrganizationName_03: 'NEW JERSEY MEDICAID',
                  ResponseContactFirstName: '', // NR
                  ResponseContactMiddleName: '', // NR
                  NamePrefix: '', // NR
                  ResponseContactNameSuffix: '', // NR
                  IdentificationCodeQualifier_08: 'PI',
                  ResponseContactIdentifier_09: '610515'
                }
              }
            },
            Loop2000C: [
              {
                Loop2300: [
                  {
                    CLM_ClaimInformation: {
                      PatientControlNumber_01: payload.customerData.accountNumber,
                      TotalClaimChargeAmount_02: payload.claimAmount.amount, // total claim amount
                      ClaimFilingIndicatorCode_03: '', // NR
                      NonInstitutionalClaimTypeCode_04: '', // NR
                      HealthCareServiceLocationInformation_05: {
                        FacilityTypeCode_01: payload.taskData.facilityTypeCode ? payload.taskData.facilityTypeCode : '99',
                        FacilityCodeQualifier_02: 'B',
                        ClaimFrequencyTypeCode_03: '1'
                      },
                      ProviderorSupplierSignatureIndicator_06: 'Y',
                      AssignmentorPlanParticipationCode_07: 'A',
                      BenefitsAssignmentCertificationIndicator_08: 'Y',
                      ReleaseofInformationCode_09: 'I'
                    },
                    AllREF: {
                      REF_ClaimPriorAuthorization: {
                        ReferenceIdentificationQualifier_01: 'G1',
                        ReferenceIdentification_02: payload.customerData.priorAuthorization
                      }
                    },
                    AllHI: {
                       HI_HealthCareDiagnosisCode: {
                      }
                    },
                    Loop2400: [
                      {
                        LX_ServiceLineNumber: {
                          AssignedNumber_01: '1'
                        },
                        SV1_ProfessionalService: {
                          CompositeMedicalProcedureIdentifier_01: {
                            ProductorServiceIDQualifier_01: 'HC',
                            ProcedureCode_02: payload.procedureCode // ?
                          },
                          LineItemChargeAmount_02: payload.claimAmount.amount, // amount
                          UnitorBasisforMeasurementCode_03: 'UN', // R
                          ServiceUnitCount_04: payload.claimAmount.units, // R 
                          PlaceofServiceCode_05: payload.taskData.placeOfServiceCode ? payload.taskData.placeOfServiceCode : '99', // S
                          ServiceTypeCode_06: '', // NR
                          CompositeDiagnosisCodePointer_07: {
                            DiagnosisCodePointer_01: '1'
                          }
                        },
                        AllDTP: {
                          DTP_Date_ServiceDate: {
                            DateTimeQualifier_01: '472',
                            DateTimePeriodFormatQualifier_02: 'RD8',
                            DateTimePeriod_03: payload.taskData.taskDOS
                          }
                        }
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    ],
    SE: {
      NumberofIncludedSegments_01: '',
      TransactionSetControlNumber_02: payload.customerData.controlNumber,
    },
    Model: 'EdiNation.X12.HIPAA.005010.Base'
  }
  let ss = 1
  for(let diagnosisCode of allDiagnosisCodes) {
    let sf = "HealthCareCodeInformation_"
    res.Loop2000A[0].Loop2000B[0].Loop2000C[0].Loop2300[0].AllHI.HI_HealthCareDiagnosisCode[sf + String(ss)] = {
      CodeListQualifierCode_01: ss === 1 ? 'ABK' : 'ABF',
      IndustryCode_02: diagnosisCode.toUpperCase().replaceAll(".",""),
    }
    ss += 1
  }
  return res
}

padIt = function(val, len) {
  var tmp = String(val)
  while(tmp.length < len) {
    tmp = '0' + tmp
  }
  return tmp
}

getControlNumber = function() {

  var date = new Date()
  var day = Math.floor(date.valueOf()/86400000) - 19255
  var secPassed = Math.floor((date.valueOf()%86400000)/1000)
  var secondPart = padIt(secPassed,5)
  var firstPart = padIt(day,4);
  return firstPart + secondPart

}

increPadWithZerosCN = function(CN) {

  var firstPartVal = parseInt(CN[0].substring(0,4))
  var secondPartVal = parseInt(CN[0].substring(4))

  var firstPartMax = 9999
  var secondPartMax = 86400

  secondPartVal += 1
  if(secondPartVal > secondPartMax) {
    secondPartVal = 0
    firstPartVal += 1
    if(firstPartVal > firstPartMax) {
      firstPartVal = 0
    }
  }

  var firstPart = padIt(firstPartVal,4)
  var secondPart = padIt(secondPartVal,5)

  CN[0] = firstPart + secondPart
  return firstPart + secondPart

}

setControlNumbers = function (medicaidJson) {
  var CN = [getControlNumber()]
  var interchangeCN = increPadWithZerosCN(CN)
  var groupCN = increPadWithZerosCN(CN)
  
  medicaidJson.ISA.InterchangeControlNumber_13 = interchangeCN
  medicaidJson.IEATrailers[0].InterchangeControlNumber_2 = interchangeCN
  medicaidJson.Groups[0].GS.GroupControlNumber_6 = groupCN
  medicaidJson.Groups[0].GETrailers[0].GroupControlNumber_2 = groupCN

  for(var i = 0; i < medicaidJson.Groups[0].Transactions.length; i++) {
    var BHTCN = increPadWithZerosCN(CN)
    // medicaidJson.Groups[0].Transactions[i].ST.TransactionSetControlNumber_02 = transactionCN
    // medicaidJson.Groups[0].Transactions[i].SE.TransactionSetControlNumber_02 = transactionCN
    medicaidJson.Groups[0].Transactions[i].BHT_BeginningOfHierarchicalTransaction.SubmitterTransactionIdentifier_03 = BHTCN
  }
}


exports.generateMedicaidJsonForMultiple = function (arrayOfTransactionObj) {

  var submitterID = '9904999'
  
  // getting current date and time
  var moment = require('moment-timezone');
  var formattedTime = moment().tz("America/New_York")
  var currentDate = formattedTime.format("YYYYMMDD")
  var currentTime = formattedTime.format("hhmm")

  var medicaidJson = {
    SegmentDelimiter: '~',
    DataElementDelimiter: '*',
    ISA: {
      AuthorizationInformationQualifier_1: '03',
      AuthorizationInformation_2: submitterID + '   ', 
      SecurityInformationQualifier_3: '00',
      SecurityInformation_4: 'NONE      ',
      SenderIDQualifier_5: 'ZZ',
      InterchangeSenderID_6: submitterID + '        ',
      ReceiverIDQualifier_7: 'ZZ',
      InterchangeReceiverID_8: '610515         ',
      InterchangeDate_9: currentDate.substring(2),
      InterchangeTime_10: currentTime,
      InterchangeControlStandardsIdentifier_11: '^',
      InterchangeControlVersionNumber_12: '00501',
      InterchangeControlNumber_13: '000003439CN',
      AcknowledgementRequested_14: '1',
      UsageIndicator_15: 'P',
      ComponentElementSeparator_16: ':'
    },
    Groups: [
      {
        GS: {
          CodeIdentifyingInformationType_1: 'HC',
          SenderIDCode_2: submitterID,
          ReceiverIDCode_3: '610515',
          Date_4: currentDate,
          Time_5: currentTime,
          GroupControlNumber_6: '1378CN',
          TransactionTypeCode_7: 'X',
          VersionAndRelease_8: '005010X222A1'
        },
        Transactions: arrayOfTransactionObj,
        GETrailers: [
          {
            NumberOfIncludedSets_1: '1',
            GroupControlNumber_2: '1378CN'
          }
        ]
      }
    ],
    IEATrailers: [
      {
        NumberOfIncludedGroups_1: '1',
        InterchangeControlNumber_2: '000003439CN'
      }
    ]
  }
  medicaidJson.Groups[0].GETrailers[0].NumberOfIncludedSets_1 = String(medicaidJson.Groups[0].Transactions.length)
  setControlNumbers(medicaidJson)
  return medicaidJson
}

exports.generateTransactionObjAZ = function (payload) {

  var moment = require('moment-timezone');
  var formattedTime = moment().tz("America/Phoenix")
  var currentDate = formattedTime.format("YYYYMMDD")
  var currentTime = formattedTime.format("hhmm")
  var allDiagnosisCodes = payload.customerData.ICD_10.split("/")

  let res = {
    ST: {
      TransactionSetIdentifierCode_01: '837',
      TransactionSetControlNumber_02: payload.customerData.controlNumber, // Must be between 4 and 9 characters in length
      ImplementationConventionPreference_03: '005010X222A1'
    },
    BHT_BeginningOfHierarchicalTransaction: { // ?
      HierarchicalStructureCode_01: '0019',
      TransactionSetPurposeCode_02: '00',
      SubmitterTransactionIdentifier_03: 'CN', // Must be between 1 and 30 characters
      TransactionSetCreationDate_04: formattedTime.format("YYYYMMDD"), // CCYYMMDD
      TransactionSetCreationTime_05: formattedTime.format("hhmm"), // HHMM
      TransactionTypeCode_06: 'CH'
    },
    AllNM1: {
      Loop1000A: {
        NM1_SubmitterName: {
          EntityIdentifierCode_01: '41',
          EntityTypeQualifier_02: '2',
          ResponseContactLastorOrganizationName_03: payload.billingData.submitterName,
          ResponseContactFirstName_04: '',
          ResponseContactMiddleName_05: '',
          NamePrefix_06: '',
          ResponseContactNameSuffix_07: '',
          IdentificationCodeQualifier_08: '46',
          ResponseContactIdentifier_09: payload.billingData.submitterID // Use Sender ID found in Providers → Provider ID Numbers
        },
        PER_SubmitterEDIContactInformation: [
          {
            ContactFunctionCode_01: 'IC',
            ResponseContactName_02: 'Prabhat', // Avoid special characters if possible (e.g., O’Shea should be sent as OShea).
            CommunicationNumberQualifier_03: 'EM',
            ResponseContactCommunicationNumber_04: 'prabhat@analytiq.us', // email address
            CommunicationNumberQualifier_05: '',
            ResponseContactCommunicationNumber_06: '',
            CommunicationNumberQualifier_07: 'TE',
            ResponseContactCommunicationNumber_08: '6097201414', // without dashes
          }
        ]
      },
      Loop1000B: {
        NM1_ReceiverName: {
          EntityIdentifierCode_01: '40', 
          EntityTypeQualifier_02: '2',
          ResponseContactLastorOrganizationName_03: payload.billingData.receiverAgencyName,
          ResponseContactFirstName_04: '',
          ResponseContactMiddleName_05: '',
          NamePrefix_06: '',
          ResponseContactNameSuffix_07: '',
          IdentificationCodeQualifier_08: '46',
          ResponseContactIdentifier_09: payload.billingData.receiverID,
        }
      }
    },
    Loop2000A: [
      {
        HL_BillingProviderHierarchicalLevel: {
          HierarchicalIDNumber_01: '1', // see TR3 guide for information on how to assign appropriate values
          HierarchicalParentIDNumber_02: '',
          HierarchicalLevelCode_03: '20',
          HierarchicalChildCode_04: '1'
        },
        AllNM1: {
          Loop2010AA: {
            NM1_BillingProviderName: { // ?
              EntityIdentifierCode_01: '85',
              EntityTypeQualifier_02: '2',
              ResponseContactLastorOrganizationName_03: payload.companyData.companyName,
              ResponseContactFirstName_04: '', // S
              ResponseContactMiddleName_05: '', // S
              NamePrefix_06: '', // NR
              ResponseContactNameSuffix_07: '', // S
              IdentificationCodeQualifier_08: 'XX', // If XX then send NPI, otherwise don't send XX leave this empty
              ResponseContactIdentifier_09: payload.companyData.npi // S => NPI of company
            },
            N3_BillingProviderAddress: {
              ResponseContactAddressLine_01: payload.companyData.address,
            },
            N4_BillingProviderCity_State_ZIPCode: {
              AdditionalPatientInformationContactCityName_01: payload.companyData.city,
              AdditionalPatientInformationContactStateCode_02: payload.companyData.state,
              AdditionalPatientInformationContactPostalZoneorZIPCode_03: payload.companyData.zip,
            },
            AllREF: {
              REF_BillingProviderTaxIdentification: {
                ReferenceIdentificationQualifier: 'EI', // R
                MemberGrouporPolicyNumber_02: payload.companyData.companyTaxID // Use/must match value in the Providers > Edit Provider > EIN/SSN field in WellSky Human Services
              }
            }
          },

          // Loop2010AB: { // ?
          //   NM1_Pay_AddressName: {
          //     EntityIdentifierCode_01: '87',
          //     EntityTypeQualifier_02: '2',
          //     ResponseContactLastorOrganizationName_03: companyData?.address
          //   },
          //   N3_Pay_ToAddress_ADDRESS: {
          //     ResponseContactAddressLine_01: companyData.companyName
          //   },
          //   N4_Pay_AddressCity_State_ZIPCode: {
          //     AdditionalPatientInformationContactCityName_01: companyData?.city,
          //     AdditionalPatientInformationContactStateCode_02: companyData?.state,
          //     AdditionalPatientInformationContactPostalZoneorZIPCode_03: companyData?.zip
          //   }
          // }
        },
        Loop2000B: [ 
          {
            HL_SubscriberHierarchicalLevel: {
              HierarchicalIDNumber_01: '2',
              HierarchicalParentIDNumber_02: '1',
              HierarchicalLevelCode_03: '22',
              HierarchicalChildCode_04: '0'
            },
            SBR_SubscriberInformation: {
              PayerResponsibilitySequenceNumberCode_01: 'P',
              IndividualRelationshipCode_02: '18', // S
              InsuredGrouporPolicyNumber_03: '', // S
              OtherInsuredGroupName: '', // S
              InsuranceTypeCode: '', // S
              CoordinationofBenefitsCode: '', // NR
              YesNoConditionorResponseCode: '', // NR
              EmploymentStatusCode: '', // NR
              ClaimFilingIndicatorCode: 'ZZ'

            },
            AllNM1: {
              Loop2010BA: {
                NM1_SubscriberName: {
                  EntityIdentifierCode_01: 'IL',
                  EntityTypeQualifier_02: '1',
                  ResponseContactLastorOrganizationName_03: payload.customerData.subscriberLastName,
                  ResponseContactFirstName_04: payload.customerData.subscriberFirstName,
                  MiddleName_05: '', //NR
                  Prefix_06: '', //NR
                  Suffix_07: '', //NR
                  IdentificationCodeQualifier_08: 'MI', 
                  IdenficationCode_09: payload.customerData.medicaidID, // AHCCCS ID 
                },
                N3_SubscriberAddress: {
                  ResponseContactAddressLine_01: payload.customerData.address, // Subscriber Address
                },
                N4_SubscriberCity_State_ZIPCode: {
                  AdditionalPatientInformationContactCityName_01: payload.customerData.city, // Subscriber City
                  AdditionalPatientInformationContactStateCode_02: payload.customerData.state, // State Code
                  AdditionalPatientInformationContactPostalZoneorZIPCode_03: payload.customerData.zip, // 9 digit zip without dashes 
                },
                DMG_SubscriberDemographicInformation: {
                  DateTimePeriodFormatQualifier_01: 'D8',
                  DependentBirthDate_02: payload.customerData.subscriberDOB, 
                  DependentGenderCode_03: payload.customerData.subscriberGender // F,M,U
                }
              },
              Loop2010BB: {
                NM1_PayerName: {
                  EntityIdentifierCode_01: 'PR',
                  EntityTypeQualifier_02: '2',
                  ResponseContactLastorOrganizationName_03: 'AZDESDDD',
                  ResponseContactFirstName: '', // NR
                  ResponseContactMiddleName: '', // NR
                  NamePrefix: '', // NR
                  ResponseContactNameSuffix: '', // NR
                  IdentificationCodeQualifier_08: 'PI',
                  ResponseContactIdentifier_09: '866004791'
                },
                // REF_ProviderSecondaryIdentification : { // situational
                //   ReferenceIdentificationQualifier_01: 'G2',
                //   ReferenceIdentification_02: '' // Provider AHCCCS ID
                // }
              }
            },
            Loop2000C: [
              {
                Loop2300: [
                  {
                    CLM_ClaimInformation: {
                      PatientControlNumber_01: payload.customerData.accountNumber, // Defined by sender. Blank and zero (0) value not accepted
                      TotalClaimChargeAmount_02: payload.customerData.claimAmount, // total claim amount
                      ClaimFilingIndicatorCode_03: '', // NR
                      NonInstitutionalClaimTypeCode_04: '', // NR
                      HealthCareServiceLocationInformation_05: {
                        FacilityTypeCode_01: '', // See Appendix A. Standard Place of Service Codes for allowable codes
                        FacilityCodeQualifier_02: 'B', 
                        ClaimFrequencyTypeCode_03: '1'
                      },
                      ProviderorSupplierSignatureIndicator_06: 'Y',
                      AssignmentorPlanParticipationCode_07: 'A',
                      BenefitsAssignmentCertificationIndicator_08: 'Y',
                      ReleaseofInformationCode_09: 'Y'
                    },
                    AllREF: {
                      REF_ClaimPriorAuthorization: {
                        ReferenceIdentificationQualifier_01: 'G1',
                        ReferenceIdentification_02: payload.customerData.priorAuthorization, // WellSky Authorization ID
                      }
                    },
                    AllHI: {
                      HI_HealthCareDiagnosisCode: {
                      }
                    },
                    Loop2400: [
                      {
                        LX_ServiceLineNumber: {
                          AssignedNumber_01: '1'
                        },
                        SV1_ProfessionalService: {
                          CompositeMedicalProcedureIdentifier_01: {
                            ProductorServiceIDQualifier_01: 'HC',
                            ProcedureCode_02: payload.customerData.procedureCode // ?
                          },
                          LineItemChargeAmount_02: payload.customerData.amount, // amount
                          UnitorBasisforMeasurementCode_03: 'UN', // R
                          ServiceUnitCount_04: payload.customerData.units, // R 
                          PlaceofServiceCode_05: '', // S
                          ServiceTypeCode_06: '', // NR
                          CompositeDiagnosisCodePointer_07: {
                            DiagnosisCodePointer_01: '1'
                          }
                        },
                        AllDTP: {
                          DTP_Date_ServiceDate: {
                            DateTimeQualifier_01: '472',
                            DateTimePeriodFormatQualifier_02: 'RD8',
                            DateTimePeriod_03: payload.taskData.taskDOS,
                          }
                        }
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    ],
    SE: {
      NumberofIncludedSegments_01: '39',
      TransactionSetControlNumber_02: 'CN'
    },
    Model: 'EdiNation.X12.HIPAA.005010.Base'
  }

  let ss = 1
  for(let diagnosisCode of allDiagnosisCodes) {
    let sf = "HealthCareCodeInformation_"
    res.Loop2000A[0].Loop2000B[0].Loop2000C[0].Loop2300[0].AllHI.HI_HealthCareDiagnosisCode[sf + String(ss)] = {
      CodeListQualifierCode_01: ss === 1 ? 'ABK' : 'ABF',
      IndustryCode_02: diagnosisCode.toUpperCase().replaceAll(".",""),
    }
    ss += 1
  }
  return res
}

exports.generateMedicaidJsonForMultipleAZ = function (arrayOfTransactionObjAZ) {

  var submitterID = '9904999'
  
  // getting current date and time
  var moment = require('moment-timezone');
  var formattedTime = moment().tz("America/Phoenix")

  var medicaidJson = {
    SegmentDelimiter: '~',
    DataElementDelimiter: '*',
    ISA: {
      AuthorizationInformationQualifier_1: '00',
      AuthorizationInformation_2: '          ', 
      SecurityInformationQualifier_3: '00',
      SecurityInformation_4: '          ',
      SenderIDQualifier_5: 'ZZ',
      InterchangeSenderID_6: '', // Use Sender ID found in Providers → Provider ID Numbers Left justify and then follow with spaces until total character count is 15 
      ReceiverIDQualifier_7: 'ZZ',
      InterchangeReceiverID_8: 'HAR_837_Upload ',
      InterchangeDate_9: formattedTime.format("YYMMDD"), // YYMMDD
      InterchangeTime_10: formattedTime.format("hhmm"), // HHMM
      InterchangeControlStandardsIdentifier_11: '^',
      InterchangeControlVersionNumber_12: '00501',
      InterchangeControlNumber_13: 'CN',
      AcknowledgementRequested_14: '1',
      UsageIndicator_15: 'P',
      ComponentElementSeparator_16: ':'
    },
    Groups: [
      {
        GS: {
          CodeIdentifyingInformationType_1: 'HC',
          SenderIDCode_2: submitterID, // Use Sender ID found in Providers → Provider ID Numbers
          ReceiverIDCode_3: 'HAR_837_Upload', 
          Date_4: formattedTime.format("YYYYMMDD"), // CCYYMMDD
          Time_5: formattedTime.format("hhmm"), // HHMM
          GroupControlNumber_6: 'CN', // Must be between 1 and 9 digits
          TransactionTypeCode_7: 'X', 
          VersionAndRelease_8: '005010X222A1'
        },
        Transactions: arrayOfTransactionObjAZ,
        GETrailers: [
          {
            NumberOfIncludedSets_1: '1',
            GroupControlNumber_2: '1378CN'
          }
        ]
      }
    ],
    IEATrailers: [
      {
        NumberOfIncludedGroups_1: '1',
        InterchangeControlNumber_2: '000003439CN'
      }
    ]
  }
  medicaidJson.Groups[0].GETrailers[0].NumberOfIncludedSets_1 = String(medicaidJson.Groups[0].Transactions.length)
  setControlNumbers(medicaidJson)
  return medicaidJson
}