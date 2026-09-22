BEGIN;

DO $$
DECLARE
  v_updated integer;
BEGIN
  WITH legacy_map (
    transaction_id,
    withdrawal_id,
    expected_amount
  ) AS (
    VALUES
      (
        'bacf0000-b8e0-4e2e-8f05-a8a6af90660b'::uuid,
        '14353ea4-0cf7-41cb-8c45-36c182873b87'::uuid,
        200::numeric
      ),
      (
        'a0d93e7b-a2a9-44f0-8d97-9176d9f7880e'::uuid,
        '5db4e44b-6dff-4df6-8bdd-8b7ea293335a'::uuid,
        200::numeric
      ),
      (
        'b6fea245-fa9d-4193-ad94-8671861a86d0'::uuid,
        'e94d2d64-b6ec-4f90-8f6a-f03e04b81719'::uuid,
        370::numeric
      ),
      (
        '6009bcae-53e4-4e0b-926c-c6468da58555'::uuid,
        'd2cea779-a156-4497-89a5-13259351aa4d'::uuid,
        314::numeric
      ),
      (
        'd0261db7-fea0-4364-b2c7-7b7999a7acec'::uuid,
        '842fe320-ccc0-4990-b1a7-9ccaf1724566'::uuid,
        100::numeric
      ),
      (
        '3c6c176c-c855-472b-9933-94c1660d359f'::uuid,
        '4358b984-3432-4894-8b9a-24ac31b86420'::uuid,
        100::numeric
      )
  )
  UPDATE public.wallet_transactions AS t
  SET
    type = 'withdrawal',
    reference_id = m.withdrawal_id
  FROM legacy_map AS m
  WHERE t.id = m.transaction_id
    AND t.type = 'adjustment'
    AND t.direction = 'debit'
    AND t.amount = m.expected_amount
    AND t.reference_id IS NULL
    AND t.description ILIKE 'Withdrawal requested%'
    AND EXISTS (
      SELECT 1
      FROM public.withdrawals AS w
      WHERE w.id = m.withdrawal_id
        AND w.user_id = t.user_id
        AND w.amount = m.expected_amount
        AND t.created_at >= w.created_at
        AND t.created_at <= w.created_at + interval '2 seconds'
    );

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated <> 6 THEN
    RAISE EXCEPTION
      'Legacy withdrawal reconciliation expected 6 rows, updated %',
      v_updated;
  END IF;
END;
$$;

COMMIT;

