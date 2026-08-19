
-- Roles
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE POLICY "users view own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

-- Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL DEFAULT 'User',
  vehicle_name TEXT,
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view own or admin" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

-- Device status (one row per user, latest snapshot)
CREATE TYPE public.tracking_status AS ENUM ('moving', 'stopped', 'idle', 'offline');

CREATE TABLE public.device_status (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  status tracking_status NOT NULL DEFAULT 'offline',
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  speed_kmh DOUBLE PRECISION DEFAULT 0,
  heading DOUBLE PRECISION,
  accuracy DOUBLE PRECISION,
  battery_level INTEGER,
  is_tracking BOOLEAN NOT NULL DEFAULT false,
  total_distance_m DOUBLE PRECISION NOT NULL DEFAULT 0,
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.device_status ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view own status or admin" ON public.device_status FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "insert own status" ON public.device_status FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "update own status" ON public.device_status FOR UPDATE TO authenticated USING (auth.uid() = user_id);

-- Location history
CREATE TABLE public.location_history (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  speed_kmh DOUBLE PRECISION,
  battery_level INTEGER,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.location_history (user_id, recorded_at DESC);
ALTER TABLE public.location_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view own history or admin" ON public.location_history FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "insert own history" ON public.location_history FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- Auto-create profile + role on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE PLPGSQL SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, vehicle_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'vehicle_name'
  );
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user');
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE PLPGSQL AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER profiles_touch BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER device_status_touch BEFORE UPDATE ON public.device_status FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Realtime
ALTER TABLE public.device_status REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.device_status;
