package com.dailytodosync.app.expenses

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Index
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@Entity(
  tableName = "expense_transactions",
  indices = [
    Index(value = ["dayKey"]),
    Index(value = ["dedupeGroupId"]),
  ],
)
data class ExpenseTransactionEntity(
  @androidx.room.PrimaryKey val id: String,
  val occurredAt: Long,
  val detectedAt: Long,
  val dayKey: String,
  val amountEncrypted: String,
  val currency: String,
  val moneyNature: String,
  val category: String?,
  val merchantEncrypted: String?,
  val accountEncrypted: String?,
  val reviewState: String,
  val confidenceLevel: String,
  val confidenceReasons: String,
  val excludedFromTotals: Boolean,
  val originalTransactionId: String?,
  val dedupeGroupId: String?,
  val sourceSummary: String,
  val createdAt: Long,
  val updatedAt: Long,
)

@Entity(
  tableName = "expense_candidates",
  indices = [
    Index(value = ["reviewState", "detectedAt"]),
    Index(value = ["contentHash"], unique = true),
  ],
)
data class ExpenseCandidateEntity(
  @androidx.room.PrimaryKey val id: String,
  val occurredAt: Long,
  val detectedAt: Long,
  val dayKey: String,
  val amountEncrypted: String?,
  val currency: String,
  val moneyNature: String,
  val category: String?,
  val merchantEncrypted: String?,
  val confidenceLevel: String,
  val confidenceReasons: String,
  val reviewState: String,
  val sourcePackage: String,
  val sourceKind: String,
  val templateId: String?,
  val parserVersion: String,
  val contentHash: String,
)

@Entity(
  tableName = "expense_evidence",
  indices = [
    Index(value = ["transactionId"]),
    Index(value = ["candidateId"]),
    Index(value = ["contentHash"]),
  ],
)
data class ExpenseEvidenceEntity(
  @androidx.room.PrimaryKey val id: String,
  val transactionId: String?,
  val candidateId: String?,
  val sourceKind: String,
  val sourcePackage: String,
  val sourceAppVersion: String?,
  val signingCertSha256: String?,
  val eventTime: Long,
  val notificationKey: String?,
  val templateId: String?,
  val parserVersion: String,
  val externalTransactionIdEncrypted: String?,
  val extractedFieldsEncrypted: String?,
  val contentHash: String,
)

@Entity(tableName = "expense_sources")
data class ExpenseSourceEntity(
  @androidx.room.PrimaryKey val packageName: String,
  val label: String,
  val versionName: String?,
  val versionCode: Long,
  val signingCertSha256: String?,
  val enabled: Boolean,
  val diagnosticCaptureEnabled: Boolean,
  val validationState: String,
  val validatedTemplateVersion: String?,
  val unknownTemplateCount: Long,
  val lastEventAt: Long?,
  val lastParsedAt: Long?,
  val updatedAt: Long,
)

@Entity(
  tableName = "expense_diagnostic_samples",
  indices = [
    Index(value = ["sourcePackage", "capturedAt"]),
    Index(value = ["contentHash"], unique = true),
  ],
)
data class ExpenseDiagnosticSampleEntity(
  @androidx.room.PrimaryKey val id: String,
  val sourcePackage: String,
  val sourceKind: String,
  val capturedAt: Long,
  val templateFingerprint: String,
  val excerptEncrypted: String,
  val contentHash: String,
)

@Entity(
  tableName = "expense_audit_events",
  indices = [Index(value = ["subjectId", "createdAt"])],
)
data class ExpenseAuditEventEntity(
  @androidx.room.PrimaryKey val id: String,
  val subjectId: String,
  val action: String,
  val detailsEncrypted: String?,
  val createdAt: Long,
)

@Dao
interface ExpenseDao {
  @Query("SELECT * FROM expense_transactions WHERE dayKey = :dayKey ORDER BY occurredAt DESC")
  fun getTransactionsForDay(dayKey: String): List<ExpenseTransactionEntity>

  @Query("SELECT * FROM expense_transactions WHERE id = :id LIMIT 1")
  fun getTransaction(id: String): ExpenseTransactionEntity?

  @Insert(onConflict = OnConflictStrategy.REPLACE)
  fun upsertTransaction(transaction: ExpenseTransactionEntity)

  @Query("DELETE FROM expense_transactions WHERE id = :id")
  fun deleteTransaction(id: String)

  @Query(
    "SELECT * FROM expense_candidates WHERE reviewState = 'pending' " +
      "ORDER BY detectedAt DESC LIMIT :limit",
  )
  fun getPendingCandidates(limit: Int): List<ExpenseCandidateEntity>

  @Query("SELECT * FROM expense_candidates WHERE id = :id LIMIT 1")
  fun getCandidate(id: String): ExpenseCandidateEntity?

  @Insert(onConflict = OnConflictStrategy.IGNORE)
  fun insertCandidate(candidate: ExpenseCandidateEntity): Long

  @Insert(onConflict = OnConflictStrategy.REPLACE)
  fun upsertCandidate(candidate: ExpenseCandidateEntity)

  @Insert(onConflict = OnConflictStrategy.REPLACE)
  fun upsertEvidence(evidence: ExpenseEvidenceEntity)

  @Query("UPDATE expense_evidence SET transactionId = :transactionId WHERE candidateId = :candidateId")
  fun attachCandidateEvidence(candidateId: String, transactionId: String)

  @Query("SELECT * FROM expense_sources ORDER BY label COLLATE NOCASE")
  fun getSources(): List<ExpenseSourceEntity>

  @Query("SELECT * FROM expense_sources WHERE enabled = 1")
  fun getEnabledSources(): List<ExpenseSourceEntity>

  @Query("SELECT * FROM expense_sources WHERE packageName = :packageName LIMIT 1")
  fun getSource(packageName: String): ExpenseSourceEntity?

  @Insert(onConflict = OnConflictStrategy.REPLACE)
  fun upsertSource(source: ExpenseSourceEntity)

  @Query(
    "UPDATE expense_sources SET unknownTemplateCount = unknownTemplateCount + 1, " +
      "lastEventAt = :eventAt, updatedAt = :eventAt WHERE packageName = :packageName",
  )
  fun recordUnknownTemplate(packageName: String, eventAt: Long)

  @Query(
    "UPDATE expense_sources SET lastEventAt = :eventAt, lastParsedAt = :eventAt, " +
      "updatedAt = :eventAt WHERE packageName = :packageName",
  )
  fun recordParsedTemplate(packageName: String, eventAt: Long)

  @Insert(onConflict = OnConflictStrategy.IGNORE)
  fun insertDiagnosticSample(sample: ExpenseDiagnosticSampleEntity): Long

  @Query(
    "SELECT * FROM expense_diagnostic_samples ORDER BY capturedAt DESC LIMIT :limit",
  )
  fun getDiagnosticSamples(limit: Int): List<ExpenseDiagnosticSampleEntity>

  @Query("DELETE FROM expense_diagnostic_samples WHERE capturedAt < :cutoff")
  fun deleteExpiredDiagnosticSamples(cutoff: Long)

  @Query("DELETE FROM expense_diagnostic_samples")
  fun clearDiagnosticSamples()

  @Insert(onConflict = OnConflictStrategy.REPLACE)
  fun insertAuditEvent(event: ExpenseAuditEventEntity)
}

@Database(
  entities = [
    ExpenseTransactionEntity::class,
    ExpenseCandidateEntity::class,
    ExpenseEvidenceEntity::class,
    ExpenseSourceEntity::class,
    ExpenseDiagnosticSampleEntity::class,
    ExpenseAuditEventEntity::class,
  ],
  version = 1,
  exportSchema = false,
)
abstract class ExpenseDatabase : RoomDatabase() {
  abstract fun expenseDao(): ExpenseDao
}

object ExpenseDatabaseProvider {
  @Volatile
  private var instance: ExpenseDatabase? = null

  fun get(context: Context): ExpenseDatabase {
    return instance ?: synchronized(this) {
      instance ?: Room.databaseBuilder(
        context.applicationContext,
        ExpenseDatabase::class.java,
        "daily-todo-expenses.db",
      ).build().also { instance = it }
    }
  }
}

class ExpenseCrypto(private val context: Context) {
  fun encrypt(value: String): String {
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
    val ciphertext = cipher.doFinal(value.toByteArray(StandardCharsets.UTF_8))
    val payload = ByteArray(1 + cipher.iv.size + ciphertext.size)
    payload[0] = cipher.iv.size.toByte()
    System.arraycopy(cipher.iv, 0, payload, 1, cipher.iv.size)
    System.arraycopy(ciphertext, 0, payload, 1 + cipher.iv.size, ciphertext.size)
    return Base64.encodeToString(payload, Base64.NO_WRAP)
  }

  fun decrypt(value: String): String {
    val payload = Base64.decode(value, Base64.NO_WRAP)
    require(payload.isNotEmpty()) { "Encrypted payload is empty." }
    val ivLength = payload[0].toInt() and 0xff
    require(ivLength in 12..16 && payload.size > ivLength + 1) {
      "Encrypted payload has an invalid IV."
    }
    val iv = payload.copyOfRange(1, 1 + ivLength)
    val ciphertext = payload.copyOfRange(1 + ivLength, payload.size)
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(128, iv))
    return String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8)
  }

  private fun getOrCreateKey(): SecretKey {
    val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }

    val generator = KeyGenerator.getInstance(
      KeyProperties.KEY_ALGORITHM_AES,
      "AndroidKeyStore",
    )
    generator.init(
      KeyGenParameterSpec.Builder(
        KEY_ALIAS,
        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
      )
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setRandomizedEncryptionRequired(true)
        .build(),
    )
    return generator.generateKey()
  }

  companion object {
    private const val KEY_ALIAS = "daily_todo_expense_fields_v1"
    private const val TRANSFORMATION = "AES/GCM/NoPadding"
  }
}
