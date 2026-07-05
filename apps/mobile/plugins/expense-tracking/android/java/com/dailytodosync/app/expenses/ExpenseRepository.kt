package com.dailytodosync.app.expenses

import android.content.Context
import java.security.MessageDigest
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID

data class ExpenseTransactionRecord(
  val id: String,
  val occurredAt: Long,
  val detectedAt: Long,
  val amountMinor: Long,
  val currency: String,
  val moneyNature: String,
  val category: String?,
  val merchant: String?,
  val account: String?,
  val reviewState: String,
  val confidenceLevel: String,
  val confidenceReasons: List<String>,
  val excludedFromTotals: Boolean,
  val originalTransactionId: String?,
  val sourceSummary: String,
)

data class ExpenseCandidateRecord(
  val id: String,
  val occurredAt: Long,
  val detectedAt: Long,
  val amountMinor: Long?,
  val currency: String,
  val moneyNature: String,
  val category: String?,
  val merchant: String?,
  val confidenceLevel: String,
  val confidenceReasons: List<String>,
  val sourcePackage: String,
  val sourceKind: String,
)

data class ParsedExpenseCandidate(
  val occurredAt: Long,
  val amountMinor: Long?,
  val currency: String,
  val moneyNature: String,
  val category: String?,
  val merchant: String?,
  val confidenceLevel: String,
  val confidenceReasons: List<String>,
  val sourcePackage: String,
  val sourceKind: String,
  val templateId: String,
  val parserVersion: String,
  val contentHash: String,
  val externalTransactionId: String?,
  val extractedFields: String?,
)

data class ExpenseDaySummary(
  val expenseMinor: Long,
  val incomeMinor: Long,
  val refundMinor: Long,
  val excludedMinor: Long,
  val transactionCount: Int,
)

data class AcceptedExpenseCapture(
  val candidate: ExpenseCandidateRecord,
  val transaction: ExpenseTransactionRecord?,
)

class ExpenseRepository(context: Context) {
  private val appContext = context.applicationContext
  private val dao = ExpenseDatabaseProvider.get(appContext).expenseDao()
  private val crypto = ExpenseCrypto(appContext)

  fun getTransactionsForDay(dayKey: String): List<ExpenseTransactionRecord> {
    return dao.getTransactionsForDay(dayKey).map(::decodeTransaction)
  }

  fun getSummaryForDay(dayKey: String): ExpenseDaySummary {
    var expense = 0L
    var income = 0L
    var refund = 0L
    var excluded = 0L
    val transactions = getTransactionsForDay(dayKey)

    transactions.forEach { transaction ->
      when {
        transaction.excludedFromTotals -> excluded += transaction.amountMinor
        transaction.moneyNature == "purchase_expense" ||
          transaction.moneyNature == "fee_interest" -> expense += transaction.amountMinor
        transaction.moneyNature == "earned_income" -> income += transaction.amountMinor
        transaction.moneyNature == "refund" -> refund += transaction.amountMinor
      }
    }

    return ExpenseDaySummary(
      expenseMinor = expense,
      incomeMinor = income,
      refundMinor = refund,
      excludedMinor = excluded,
      transactionCount = transactions.size,
    )
  }

  fun addManualTransaction(
    amountMinor: Long,
    occurredAt: Long,
    moneyNature: String,
    category: String?,
    merchant: String?,
  ): ExpenseTransactionRecord {
    require(amountMinor > 0) { "Amount must be greater than zero." }
    require(moneyNature in ALLOWED_MONEY_NATURES) { "Unsupported money nature." }
    val now = System.currentTimeMillis()
    val transaction = ExpenseTransactionEntity(
      id = UUID.randomUUID().toString(),
      occurredAt = occurredAt,
      detectedAt = now,
      dayKey = dayKey(occurredAt),
      amountEncrypted = crypto.encrypt(amountMinor.toString()),
      currency = "CNY",
      moneyNature = moneyNature,
      category = category?.takeIf { it.isNotBlank() },
      merchantEncrypted = merchant?.trim()?.takeIf { it.isNotEmpty() }?.let(crypto::encrypt),
      accountEncrypted = null,
      reviewState = "confirmed",
      confidenceLevel = "user_confirmed",
      confidenceReasons = "manual_entry",
      excludedFromTotals = shouldExcludeFromTotals(moneyNature),
      originalTransactionId = null,
      dedupeGroupId = null,
      sourceSummary = "manual",
      createdAt = now,
      updatedAt = now,
    )
    dao.upsertTransaction(transaction)
    audit(transaction.id, "manual_create", null)
    return decodeTransaction(transaction)
  }

  fun getPendingCandidates(limit: Int = 100): List<ExpenseCandidateRecord> {
    return dao.getPendingCandidates(limit.coerceIn(1, 500)).map(::decodeCandidate)
  }

  fun confirmCandidate(
    candidateId: String,
    moneyNatureOverride: String?,
    categoryOverride: String?,
  ): ExpenseTransactionRecord {
    val candidate = requireNotNull(dao.getCandidate(candidateId)) {
      "Candidate was not found."
    }
    check(candidate.reviewState == "pending") { "Candidate is no longer pending." }
    val amountEncrypted = requireNotNull(candidate.amountEncrypted) {
      "Candidate has no confirmed amount."
    }
    val moneyNature = moneyNatureOverride ?: candidate.moneyNature
    require(moneyNature in ALLOWED_MONEY_NATURES) { "Unsupported money nature." }
    val now = System.currentTimeMillis()
    val transaction = ExpenseTransactionEntity(
      id = UUID.randomUUID().toString(),
      occurredAt = candidate.occurredAt,
      detectedAt = candidate.detectedAt,
      dayKey = candidate.dayKey,
      amountEncrypted = amountEncrypted,
      currency = candidate.currency,
      moneyNature = moneyNature,
      category = categoryOverride ?: candidate.category,
      merchantEncrypted = candidate.merchantEncrypted,
      accountEncrypted = null,
      reviewState = "confirmed",
      confidenceLevel = "user_confirmed",
      confidenceReasons = candidate.confidenceReasons + ",user_confirmed",
      excludedFromTotals = shouldExcludeFromTotals(moneyNature),
      originalTransactionId = null,
      dedupeGroupId = null,
      sourceSummary = "${candidate.sourceKind}:${candidate.sourcePackage}",
      createdAt = now,
      updatedAt = now,
    )
    dao.upsertTransaction(transaction)
    dao.upsertCandidate(candidate.copy(reviewState = "confirmed"))
    dao.attachCandidateEvidence(candidate.id, transaction.id)
    audit(transaction.id, "candidate_confirm", candidate.id)
    return decodeTransaction(transaction)
  }

  fun ignoreCandidate(candidateId: String) {
    val candidate = requireNotNull(dao.getCandidate(candidateId)) {
      "Candidate was not found."
    }
    dao.upsertCandidate(candidate.copy(reviewState = "ignored"))
    audit(candidate.id, "candidate_ignore", null)
  }

  fun deleteTransaction(transactionId: String) {
    val existing = requireNotNull(dao.getTransaction(transactionId)) {
      "Transaction was not found."
    }
    dao.deleteTransaction(existing.id)
    audit(existing.id, "delete", null)
  }

  fun acceptParsedCandidate(candidate: ParsedExpenseCandidate): AcceptedExpenseCapture? {
    val now = System.currentTimeMillis()
    val candidateId = UUID.randomUUID().toString()
    val entity = ExpenseCandidateEntity(
      id = candidateId,
      occurredAt = candidate.occurredAt,
      detectedAt = now,
      dayKey = dayKey(candidate.occurredAt),
      amountEncrypted = candidate.amountMinor?.let { crypto.encrypt(it.toString()) },
      currency = candidate.currency,
      moneyNature = candidate.moneyNature,
      category = candidate.category,
      merchantEncrypted = candidate.merchant?.let(crypto::encrypt),
      confidenceLevel = candidate.confidenceLevel,
      confidenceReasons = candidate.confidenceReasons.joinToString(","),
      reviewState = "pending",
      sourcePackage = candidate.sourcePackage,
      sourceKind = candidate.sourceKind,
      templateId = candidate.templateId,
      parserVersion = candidate.parserVersion,
      contentHash = candidate.contentHash,
    )
    if (dao.insertCandidate(entity) == -1L) {
      return null
    }

    dao.upsertEvidence(
      ExpenseEvidenceEntity(
        id = UUID.randomUUID().toString(),
        transactionId = null,
        candidateId = candidateId,
        sourceKind = candidate.sourceKind,
        sourcePackage = candidate.sourcePackage,
        sourceAppVersion = getSource(candidate.sourcePackage)?.versionName,
        signingCertSha256 = getSource(candidate.sourcePackage)?.signingCertSha256,
        eventTime = candidate.occurredAt,
        notificationKey = null,
        templateId = candidate.templateId,
        parserVersion = candidate.parserVersion,
        externalTransactionIdEncrypted =
          candidate.externalTransactionId?.let(crypto::encrypt),
        extractedFieldsEncrypted = candidate.extractedFields?.let(crypto::encrypt),
        contentHash = candidate.contentHash,
      ),
    )
    dao.recordParsedTemplate(candidate.sourcePackage, now)

    val confirmedTransaction =
      if (candidate.confidenceLevel == "high" && candidate.amountMinor != null) {
        confirmCandidate(candidateId, null, null)
      } else {
        null
      }
    return AcceptedExpenseCapture(
      candidate = decodeCandidate(entity),
      transaction = confirmedTransaction,
    )
  }

  fun getSources(): List<ExpenseSourceEntity> = dao.getSources()

  fun getEnabledSources(): List<ExpenseSourceEntity> = dao.getEnabledSources()

  fun getSource(packageName: String): ExpenseSourceEntity? = dao.getSource(packageName)

  fun upsertSource(
    packageName: String,
    label: String,
    versionName: String?,
    versionCode: Long,
    signingCertSha256: String?,
    enabled: Boolean,
    diagnosticCaptureEnabled: Boolean,
  ): ExpenseSourceEntity {
    val existing = dao.getSource(packageName)
    val signatureChanged =
      existing?.signingCertSha256 != null &&
        signingCertSha256 != null &&
        existing.signingCertSha256 != signingCertSha256
    val versionChanged = existing != null && existing.versionCode != versionCode
    val source = ExpenseSourceEntity(
      packageName = packageName,
      label = label,
      versionName = versionName,
      versionCode = versionCode,
      signingCertSha256 = signingCertSha256,
      enabled = enabled,
      diagnosticCaptureEnabled = diagnosticCaptureEnabled,
      validationState = when {
        signatureChanged -> "signature_changed"
        versionChanged -> "version_changed"
        existing != null -> existing.validationState
        else -> "unvalidated"
      },
      validatedTemplateVersion =
        if (signatureChanged || versionChanged) null else existing?.validatedTemplateVersion,
      unknownTemplateCount = existing?.unknownTemplateCount ?: 0L,
      lastEventAt = existing?.lastEventAt,
      lastParsedAt = existing?.lastParsedAt,
      updatedAt = System.currentTimeMillis(),
    )
    dao.upsertSource(source)
    return source
  }

  fun recordUnknownTemplate(packageName: String, eventAt: Long) {
    dao.recordUnknownTemplate(packageName, eventAt)
  }

  fun addDiagnosticSample(
    sourcePackage: String,
    sourceKind: String,
    templateFingerprint: String,
    excerpt: String,
  ) {
    val normalizedExcerpt = excerpt.trim().take(MAX_DIAGNOSTIC_EXCERPT_LENGTH)
    if (normalizedExcerpt.isEmpty()) return
    val contentHash = sha256("$sourcePackage|$sourceKind|$templateFingerprint|$normalizedExcerpt")
    dao.insertDiagnosticSample(
      ExpenseDiagnosticSampleEntity(
        id = UUID.randomUUID().toString(),
        sourcePackage = sourcePackage,
        sourceKind = sourceKind,
        capturedAt = System.currentTimeMillis(),
        templateFingerprint = templateFingerprint,
        excerptEncrypted = crypto.encrypt(normalizedExcerpt),
        contentHash = contentHash,
      ),
    )
    dao.deleteExpiredDiagnosticSamples(
      System.currentTimeMillis() - DIAGNOSTIC_RETENTION_MILLIS,
    )
  }

  fun getDiagnosticSamples(limit: Int = 100): List<Pair<ExpenseDiagnosticSampleEntity, String>> {
    return dao.getDiagnosticSamples(limit.coerceIn(1, 500)).map { sample ->
      sample to crypto.decrypt(sample.excerptEncrypted)
    }
  }

  fun clearDiagnosticSamples() {
    dao.clearDiagnosticSamples()
  }

  fun clearExpiredDiagnosticSamples() {
    dao.deleteExpiredDiagnosticSamples(
      System.currentTimeMillis() - DIAGNOSTIC_RETENTION_MILLIS,
    )
  }

  private fun decodeTransaction(entity: ExpenseTransactionEntity): ExpenseTransactionRecord {
    return ExpenseTransactionRecord(
      id = entity.id,
      occurredAt = entity.occurredAt,
      detectedAt = entity.detectedAt,
      amountMinor = crypto.decrypt(entity.amountEncrypted).toLong(),
      currency = entity.currency,
      moneyNature = entity.moneyNature,
      category = entity.category,
      merchant = entity.merchantEncrypted?.let(crypto::decrypt),
      account = entity.accountEncrypted?.let(crypto::decrypt),
      reviewState = entity.reviewState,
      confidenceLevel = entity.confidenceLevel,
      confidenceReasons = entity.confidenceReasons.split(",").filter(String::isNotBlank),
      excludedFromTotals = entity.excludedFromTotals,
      originalTransactionId = entity.originalTransactionId,
      sourceSummary = entity.sourceSummary,
    )
  }

  private fun decodeCandidate(entity: ExpenseCandidateEntity): ExpenseCandidateRecord {
    return ExpenseCandidateRecord(
      id = entity.id,
      occurredAt = entity.occurredAt,
      detectedAt = entity.detectedAt,
      amountMinor = entity.amountEncrypted?.let { crypto.decrypt(it).toLong() },
      currency = entity.currency,
      moneyNature = entity.moneyNature,
      category = entity.category,
      merchant = entity.merchantEncrypted?.let(crypto::decrypt),
      confidenceLevel = entity.confidenceLevel,
      confidenceReasons = entity.confidenceReasons.split(",").filter(String::isNotBlank),
      sourcePackage = entity.sourcePackage,
      sourceKind = entity.sourceKind,
    )
  }

  private fun audit(subjectId: String, action: String, details: String?) {
    dao.insertAuditEvent(
      ExpenseAuditEventEntity(
        id = UUID.randomUUID().toString(),
        subjectId = subjectId,
        action = action,
        detailsEncrypted = details?.let(crypto::encrypt),
        createdAt = System.currentTimeMillis(),
      ),
    )
  }

  companion object {
    private const val DIAGNOSTIC_RETENTION_MILLIS = 7L * 24L * 60L * 60L * 1000L
    private const val MAX_DIAGNOSTIC_EXCERPT_LENGTH = 1200
    val ALLOWED_MONEY_NATURES = setOf(
      "purchase_expense",
      "earned_income",
      "refund",
      "internal_transfer",
      "personal_transfer",
      "credit_repayment",
      "wallet_topup_withdrawal",
      "loan_principal",
      "investment_principal",
      "cash_withdrawal_deposit",
      "fee_interest",
      "reversal_failed",
      "unknown_money_flow",
    )

    fun dayKey(timestamp: Long): String {
      return Instant.ofEpochMilli(timestamp)
        .atZone(ZoneId.systemDefault())
        .toLocalDate()
        .toString()
    }

    fun todayKey(): String = LocalDate.now().toString()

    fun shouldExcludeFromTotals(moneyNature: String): Boolean {
      return moneyNature !in setOf(
        "purchase_expense",
        "earned_income",
        "refund",
        "fee_interest",
      )
    }

    fun sha256(value: String): String {
      val digest = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(Charsets.UTF_8))
      return digest.joinToString("") { byte -> "%02x".format(byte) }
    }
  }
}
