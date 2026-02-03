-- Function to create a user with a properly hashed password
-- Run this in Supabase SQL editor if not already present

CREATE OR REPLACE FUNCTION create_user_with_password(
  p_username TEXT,
  p_password TEXT,
  p_display_name TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_tenant_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id INTEGER,
  username TEXT,
  display_name TEXT,
  email TEXT,
  is_active BOOLEAN,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  INSERT INTO users (username, password_hash, display_name, email, tenant_id, is_active)
  VALUES (
    p_username,
    crypt(p_password, gen_salt('bf')),
    p_display_name,
    p_email,
    p_tenant_id,
    TRUE
  )
  RETURNING users.id, users.username, users.display_name, users.email, users.is_active, users.created_at;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users (for admin API)
GRANT EXECUTE ON FUNCTION create_user_with_password TO authenticated;
GRANT EXECUTE ON FUNCTION create_user_with_password TO service_role;

-- Example: Create a user manually
-- SELECT * FROM create_user_with_password('Winbros Cleaning', 'password', 'Winbros Cleaning', NULL, NULL);
