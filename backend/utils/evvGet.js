const { DBinsertSendID, DBUpdate, DBinsertSendResponse, DBSendResponse} = require("../queries/commonQueries")

exports.getReadyVisits = async function () {
	var query = `select providerTaxId,
		office_qualifier as 'office.qualifier',
		office_identifier as 'office.identifier',
		member_qualifier as 'member.qualifier',
		member_identifier as 'member.identifier',
		caregiver_qualifier as 'cargiver.qualifier',
		caregiver_identifier as 'cargiver.identifier',
		payerId, CONVERT(varchar(30), externalVisitId) as externalVisitId,
		evvmsid, procedureCode, procedureModifierCode, timezone,
		scheduleStartTime, scheduleEndTime, visitStartDateTime, visitEndDateTime, timesheetRequired, timesheetApproved,
		evv_clockIn_callDateTime as 'evv.clockIn.callDateTime',
		evv_clockIn_callType as 'evv.clockIn.callType',
		evv_clockIn_callLatitude as 'evv.clockIn.callLatitude',
		evv_clockIn_callLongitude as 'evv.clockIn.callLongitude',
		evv_clockIn_originatingPhoneNumber as 'evv.clockIn.originatingPhoneNumber',
		evv_clockIn_serviceAddress_addressLine1 as 'evv.clockIn.serciceAddress.addressLine1',
		evv_clockIn_serviceAddress_addressLine2 as 'evv.clockIn.serciceAddress.addressLine2',
		evv_clockIn_serviceAddress_city as 'evv.clockIn.serciceAddress.city',
		evv_clockIn_serviceAddress_state as 'evv.clockIn.serciceAddress.state',
		evv_clockIn_serviceAddress_zipcode as 'evv.clockIn.serciceAddress.zipcode',
		evv_clockOut_callDateTime as 'evv.clockOut.callDateTime',
		evv_clockOut_callType as 'evv.clockOut.callType',
		evv_clockOut_callLatitude as 'evv.clockOut.callLatitude',
		evv_clockOut_callLongitude as 'evv.clockOut.callLongitude',
		evv_clockOut_originatingPhoneNumber as 'evv.clockOut.calloriginatingPhoneNumber',
		evv_clockOut_serviceAddress_addressLine1 as 'evv.clockOut.serviceAddress.addressLine1',
		evv_clockOut_serviceAddress_addressLine2 as 'evv.clockOut.serviceAddress.addressLine2',
		evv_clockOut_serviceAddress_city as 'evv.clockOut.serviceAddress.city',
		evv_clockOut_serviceAddress_state as 'evv.clockOut.serviceAddress.state',
		evv_clockOut_serviceAddress_zipcode as 'evv.clockOut.serviceAddress.zipcode',
		evv_clockOut_preformedTasks as 'evv.clockOut.preformedTasks',
		evv_clockOut_refusedTasks as 'evv.clockOut.refusedTasks',
		missedVisit_missed as 'missedVisit.missed',
		missedVisit_reasonCode as 'missedVisit.reasonCode',
		missedVisit_actionCode as 'missedVisit.actionCode',
		missedVisti_notes as 'missedVisit.notes',
		editVisit_edited as 'editVisit.edited',
		editVisit_reasonCode as 'editVisit.reasonCode',
		editVisit_actionCode as 'editVisit.actionCode',
		editVisit_notes as 'editVisit.notes',
		billing_externalInvoiceNumber as 'billing.externalInvoiceNumber',
		billing_totalBilledAmount as 'billing.totalBilledAmount',
		billing_totalUnitsBilled as 'billing.totalUnitsBilled',
		billing_contractRate as 'billing.contractRate',
		billing_diagnosisCodes as 'billing.diagnosisCode',
		billSecondaryPayer_enableSecondaryBilling as 'billingSecondaryPayer.enableSecondaryBilling',
		billSecondaryPayer_otherSubscriberId as 'billingSecondaryPayer.otherSubscriberId',
		billSecondaryPayer_primaryPayerId as 'billingSecondaryPayer.primaryPayerId',
		billSecondaryPayer_primaryPayerName as 'billingSecondaryPayer.primaryPayerName',
		billSecondaryPayer_relationshipToInsured as 'billingSecondaryPayer.relationshipToInsured',
		billSecondaryPayer_primaryPayerPolicyOrGroupName as 'billingSecondaryPayer.primaryPayerPolicyOrGroupName',
		billSecondaryPayer_primaryPayerProgramName as 'billingSecondaryPayer.primaryPayerProgramName',
		billSecondaryPayer_playType as 'billingSecondaryPayer.playType',
		billSecondaryPayer_totalPaidAmount as 'billingSecondaryPayer.totalPaidAmount',
		billSecondaryPayer_paidDate as 'billingSecondaryPayer.paidDate',
		billSecondaryPayer_deductible as 'billingSecondaryPayer.deductible',
		billSecondaryPayer_coinsurance as 'billingSecondaryPayer.coinsurance',
		billSecondaryPayer_copay as 'billingSecondaryPayer.copay',
		billSecondaryPayer_contractedAdjustments as 'billingSecondaryPayer.contractedAdjustments',
		billSecondaryPayer_notMedicallyNecessary as 'billingSecondaryPayer.notMedicallyNecessary',
		billSecondaryPayer_nonCoveredCharges as 'billingSecondaryPayer.nonCoveredCharges',
		billSecondaryPayer_maxBenefitExhausted as 'billingSecondaryPayer.maxBenefitExhausted'
		from evv where record_status = 1 for json path`

	data = await DBSendResponse(query)
	console.log(data)
	if (!!data.procedureModifierCode) {
		data.procedureModifierCode = data.procedureModifierCode.split(',')
	}
	if (!!data.evv.clockOut.performedTasks) {
		var arr = data.evv.clockOut.performedTasks.split(',')
		for (let i = 0; i < arr.length; i++) {
			arr[i] = {'code': arr[i]}
		}
		data.evv.clockOut.performedTasks = arr
	}
	if (!!data.evv.clockOut.refusedTasks) {
		var arr = data.evv.clockOut.refusedTasks.split(',')
		for (let i = 0; i < arr.length; i++) {
			arr[i] = { 'code': arr[i] }
		}
		data.evv.clockOut.refusedTasks = arr
	}
	if (!!data.billing.diagnosisCodes) {
		data.billing.diagnosisCodes = data.billing.diagnosisCodes.split(',')
	}

	return data
}

exports.getUpdateVisits = async function () {
	var query = `select providerTaxId,
		office_qualifier as 'office.qualifier',
		office_identifier as 'office.identifier',
		member_qualifier as 'member.qualifier',
		member_identifier as 'member.identifier',
		caregiver_qualifier as 'cargiver.qualifier',
		caregiver_identifier as 'cargiver.identifier',
		payerId, CONVERT(varchar(30), externalVisitId) as externalVisitId,
		evvmsid, procedureCode, procedureModifierCode, timezone,
		scheduleStartTime, scheduleEndTime, visitStartDateTime, visitEndDateTime, timesheetRequired, timesheetApproved,
		evv_clockIn_callDateTime as 'evv.clockIn.callDateTime',
		evv_clockIn_callType as 'evv.clockIn.callType',
		evv_clockIn_callLatitude as 'evv.clockIn.callLatitude',
		evv_clockIn_callLongitude as 'evv.clockIn.callLongitude',
		evv_clockIn_originatingPhoneNumber as 'evv.clockIn.originatingPhoneNumber',
		evv_clockIn_serviceAddress_addressLine1 as 'evv.clockIn.serciceAddress.addressLine1',
		evv_clockIn_serviceAddress_addressLine2 as 'evv.clockIn.serciceAddress.addressLine2',
		evv_clockIn_serviceAddress_city as 'evv.clockIn.serciceAddress.city',
		evv_clockIn_serviceAddress_state as 'evv.clockIn.serciceAddress.state',
		evv_clockIn_serviceAddress_zipcode as 'evv.clockIn.serciceAddress.zipcode',
		evv_clockOut_callDateTime as 'evv.clockOut.callDateTime',
		evv_clockOut_callType as 'evv.clockOut.callType',
		evv_clockOut_callLatitude as 'evv.clockOut.callLatitude',
		evv_clockOut_callLongitude as 'evv.clockOut.callLongitude',
		evv_clockOut_originatingPhoneNumber as 'evv.clockOut.calloriginatingPhoneNumber',
		evv_clockOut_serviceAddress_addressLine1 as 'evv.clockOut.serviceAddress.addressLine1',
		evv_clockOut_serviceAddress_addressLine2 as 'evv.clockOut.serviceAddress.addressLine2',
		evv_clockOut_serviceAddress_city as 'evv.clockOut.serviceAddress.city',
		evv_clockOut_serviceAddress_state as 'evv.clockOut.serviceAddress.state',
		evv_clockOut_serviceAddress_zipcode as 'evv.clockOut.serviceAddress.zipcode',
		evv_clockOut_preformedTasks as 'evv.clockOut.preformedTasks',
		evv_clockOut_refusedTasks as 'evv.clockOut.refusedTasks',
		missedVisit_missed as 'missedVisit.missed',
		missedVisit_reasonCode as 'missedVisit.reasonCode',
		missedVisit_actionCode as 'missedVisit.actionCode',
		missedVisti_notes as 'missedVisit.notes',
		editVisit_edited as 'editVisit.edited',
		editVisit_reasonCode as 'editVisit.reasonCode',
		editVisit_actionCode as 'editVisit.actionCode',
		editVisit_notes as 'editVisit.notes',
		billing_externalInvoiceNumber as 'billing.externalInvoiceNumber',
		billing_totalBilledAmount as 'billing.totalBilledAmount',
		billing_totalUnitsBilled as 'billing.totalUnitsBilled',
		billing_contractRate as 'billing.contractRate',
		billing_diagnosisCodes as 'billing.diagnosisCode',
		billSecondaryPayer_enableSecondaryBilling as 'billingSecondaryPayer.enableSecondaryBilling',
		billSecondaryPayer_otherSubscriberId as 'billingSecondaryPayer.otherSubscriberId',
		billSecondaryPayer_primaryPayerId as 'billingSecondaryPayer.primaryPayerId',
		billSecondaryPayer_primaryPayerName as 'billingSecondaryPayer.primaryPayerName',
		billSecondaryPayer_relationshipToInsured as 'billingSecondaryPayer.relationshipToInsured',
		billSecondaryPayer_primaryPayerPolicyOrGroupName as 'billingSecondaryPayer.primaryPayerPolicyOrGroupName',
		billSecondaryPayer_primaryPayerProgramName as 'billingSecondaryPayer.primaryPayerProgramName',
		billSecondaryPayer_playType as 'billingSecondaryPayer.playType',
		billSecondaryPayer_totalPaidAmount as 'billingSecondaryPayer.totalPaidAmount',
		billSecondaryPayer_paidDate as 'billingSecondaryPayer.paidDate',
		billSecondaryPayer_deductible as 'billingSecondaryPayer.deductible',
		billSecondaryPayer_coinsurance as 'billingSecondaryPayer.coinsurance',
		billSecondaryPayer_copay as 'billingSecondaryPayer.copay',
		billSecondaryPayer_contractedAdjustments as 'billingSecondaryPayer.contractedAdjustments',
		billSecondaryPayer_notMedicallyNecessary as 'billingSecondaryPayer.notMedicallyNecessary',
		billSecondaryPayer_nonCoveredCharges as 'billingSecondaryPayer.nonCoveredCharges',
		billSecondaryPayer_maxBenefitExhausted as 'billingSecondaryPayer.maxBenefitExhausted'
		from evv where record_status = 2 for json path`

	data = await DBSendResponse(query)
	if (!!data.procedureModifierCode) {
		data.procedureModifierCode = data.procedureModifierCode.split(',')
	}
	if (!!data.evv.clockOut.performedTasks) {
		var arr = data.evv.clockOut.performedTasks.split(',')
		for (let i = 0; i < arr.length; i++) {
			arr[i] = { 'code': arr[i] }
		}
		data.evv.clockOut.performedTasks = arr
	}
	if (!!data.evv.clockOut.refusedTasks) {
		var arr = data.evv.clockOut.refusedTasks.split(',')
		for (let i = 0; i < arr.length; i++) {
			arr[i] = { 'code': arr[i] }
		}
		data.evv.clockOut.refusedTasks = arr
	}
	if (!!data.billing.diagnosisCodes) {
		data.billing.diagnosisCodes = data.billing.diagnosisCodes.split(',')
	}

	return data
}

