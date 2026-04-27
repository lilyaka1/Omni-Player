--
-- PostgreSQL database dump
--

\restrict Q1scbpABV6MqEMl9OmZgloKcu0L17YNslRDkCfWbH84uBWpkYVclego0w7S64q7

-- Dumped from database version 15.16
-- Dumped by pg_dump version 15.16

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: roleenum; Type: TYPE; Schema: public; Owner: user
--

CREATE TYPE public.roleenum AS ENUM (
    'USER',
    'ADMIN'
);


ALTER TYPE public.roleenum OWNER TO "user";

--
-- Name: roomroleenum; Type: TYPE; Schema: public; Owner: user
--

CREATE TYPE public.roomroleenum AS ENUM (
    'ADMIN',
    'MODERATOR',
    'USER'
);


ALTER TYPE public.roomroleenum OWNER TO "user";

--
-- Name: sourceenum; Type: TYPE; Schema: public; Owner: user
--

CREATE TYPE public.sourceenum AS ENUM (
    'SOUNDCLOUD',
    'YOUTUBE',
    'SPOTIFY',
    'LOCAL'
);


ALTER TYPE public.sourceenum OWNER TO "user";

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: message; Type: TABLE; Schema: public; Owner: user
--

CREATE TABLE public.message (
    id integer NOT NULL,
    room_id integer,
    user_id integer,
    content character varying,
    created_at timestamp without time zone
);


ALTER TABLE public.message OWNER TO "user";

--
-- Name: message_id_seq; Type: SEQUENCE; Schema: public; Owner: user
--

CREATE SEQUENCE public.message_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.message_id_seq OWNER TO "user";

--
-- Name: message_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: user
--

ALTER SEQUENCE public.message_id_seq OWNED BY public.message.id;


--
-- Name: playlist; Type: TABLE; Schema: public; Owner: user
--

CREATE TABLE public.playlist (
    id integer NOT NULL,
    owner_id integer NOT NULL,
    name character varying NOT NULL,
    description character varying,
    thumbnail character varying,
    is_album boolean,
    source public.sourceenum,
    source_playlist_id character varying,
    is_public boolean,
    track_count integer,
    total_duration double precision,
    created_at timestamp without time zone,
    updated_at timestamp without time zone
);


ALTER TABLE public.playlist OWNER TO "user";

--
-- Name: playlist_id_seq; Type: SEQUENCE; Schema: public; Owner: user
--

CREATE SEQUENCE public.playlist_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.playlist_id_seq OWNER TO "user";

--
-- Name: playlist_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: user
--

ALTER SEQUENCE public.playlist_id_seq OWNED BY public.playlist.id;


--
-- Name: playlist_track; Type: TABLE; Schema: public; Owner: user
--

CREATE TABLE public.playlist_track (
    id integer NOT NULL,
    playlist_id integer NOT NULL,
    track_id integer NOT NULL,
    "order" integer NOT NULL,
    added_at timestamp without time zone
);


ALTER TABLE public.playlist_track OWNER TO "user";

--
-- Name: playlist_track_id_seq; Type: SEQUENCE; Schema: public; Owner: user
--

CREATE SEQUENCE public.playlist_track_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.playlist_track_id_seq OWNER TO "user";

--
-- Name: playlist_track_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: user
--

ALTER SEQUENCE public.playlist_track_id_seq OWNED BY public.playlist_track.id;


--
-- Name: room; Type: TABLE; Schema: public; Owner: user
--

CREATE TABLE public.room (
    id integer NOT NULL,
    creator_id integer,
    name character varying,
    description character varying,
    is_active boolean,
    created_at timestamp without time zone,
    updated_at timestamp without time zone,
    now_playing_track_id integer,
    playback_started_at timestamp without time zone,
    is_playing boolean DEFAULT true,
    queue_mode character varying DEFAULT 'loop'::character varying
);


ALTER TABLE public.room OWNER TO "user";

--
-- Name: room_id_seq; Type: SEQUENCE; Schema: public; Owner: user
--

CREATE SEQUENCE public.room_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.room_id_seq OWNER TO "user";

--
-- Name: room_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: user
--

ALTER SEQUENCE public.room_id_seq OWNED BY public.room.id;


--
-- Name: room_track; Type: TABLE; Schema: public; Owner: user
--

CREATE TABLE public.room_track (
    id integer NOT NULL,
    room_id integer,
    source public.sourceenum,
    source_track_id character varying,
    title character varying,
    artist character varying,
    duration double precision,
    stream_url character varying,
    "order" integer,
    added_by_id integer,
    created_at timestamp without time zone,
    thumbnail character varying,
    genre character varying
);


ALTER TABLE public.room_track OWNER TO "user";

--
-- Name: room_track_id_seq; Type: SEQUENCE; Schema: public; Owner: user
--

CREATE SEQUENCE public.room_track_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.room_track_id_seq OWNER TO "user";

--
-- Name: room_track_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: user
--

ALTER SEQUENCE public.room_track_id_seq OWNED BY public.room_track.id;


--
-- Name: track; Type: TABLE; Schema: public; Owner: user
--

CREATE TABLE public.track (
    id integer NOT NULL,
    source public.sourceenum NOT NULL,
    source_track_id character varying NOT NULL,
    source_page_url character varying NOT NULL,
    title character varying NOT NULL,
    artist character varying,
    album character varying,
    duration double precision,
    genre character varying,
    year integer,
    stream_url character varying NOT NULL,
    stream_url_expires_at timestamp without time zone NOT NULL,
    thumbnail_url character varying,
    bitrate integer,
    codec character varying,
    total_plays integer,
    unique_listeners integer,
    created_at timestamp without time zone,
    updated_at timestamp without time zone,
    local_file_path character varying
);


ALTER TABLE public.track OWNER TO "user";

--
-- Name: track_id_seq; Type: SEQUENCE; Schema: public; Owner: user
--

CREATE SEQUENCE public.track_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.track_id_seq OWNER TO "user";

--
-- Name: track_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: user
--

ALTER SEQUENCE public.track_id_seq OWNED BY public.track.id;


--
-- Name: user; Type: TABLE; Schema: public; Owner: user
--

CREATE TABLE public."user" (
    id integer NOT NULL,
    email character varying,
    username character varying,
    password_hash character varying,
    role public.roleenum,
    is_blocked boolean,
    can_create_rooms boolean,
    created_at timestamp without time zone
);


ALTER TABLE public."user" OWNER TO "user";

--
-- Name: user_id_seq; Type: SEQUENCE; Schema: public; Owner: user
--

CREATE SEQUENCE public.user_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.user_id_seq OWNER TO "user";

--
-- Name: user_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: user
--

ALTER SEQUENCE public.user_id_seq OWNED BY public."user".id;


--
-- Name: user_room; Type: TABLE; Schema: public; Owner: user
--

CREATE TABLE public.user_room (
    user_id integer,
    room_id integer,
    joined_at timestamp without time zone,
    role character varying DEFAULT 'user'::character varying,
    is_banned boolean DEFAULT false
);


ALTER TABLE public.user_room OWNER TO "user";

--
-- Name: user_track; Type: TABLE; Schema: public; Owner: user
--

CREATE TABLE public.user_track (
    id integer NOT NULL,
    user_id integer NOT NULL,
    track_id integer NOT NULL,
    added_at timestamp without time zone,
    is_favorite boolean,
    play_count integer,
    last_played_at timestamp without time zone,
    user_rating integer,
    user_notes character varying
);


ALTER TABLE public.user_track OWNER TO "user";

--
-- Name: user_track_id_seq; Type: SEQUENCE; Schema: public; Owner: user
--

CREATE SEQUENCE public.user_track_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.user_track_id_seq OWNER TO "user";

--
-- Name: user_track_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: user
--

ALTER SEQUENCE public.user_track_id_seq OWNED BY public.user_track.id;


--
-- Name: message id; Type: DEFAULT; Schema: public; Owner: user
--

ALTER TABLE ONLY public.message ALTER COLUMN id SET DEFAULT nextval('public.message_id_seq'::regclass);


--
-- Name: playlist id; Type: DEFAULT; Schema: public; Owner: user
--

ALTER TABLE ONLY public.playlist ALTER COLUMN id SET DEFAULT nextval('public.playlist_id_seq'::regclass);


--
-- Name: playlist_track id; Type: DEFAULT; Schema: public; Owner: user
--

ALTER TABLE ONLY public.playlist_track ALTER COLUMN id SET DEFAULT nextval('public.playlist_track_id_seq'::regclass);


--
-- Name: room id; Type: DEFAULT; Schema: public; Owner: user
--

ALTER TABLE ONLY public.room ALTER COLUMN id SET DEFAULT nextval('public.room_id_seq'::regclass);


--
-- Name: room_track id; Type: DEFAULT; Schema: public; Owner: user
--

ALTER TABLE ONLY public.room_track ALTER COLUMN id SET DEFAULT nextval('public.room_track_id_seq'::regclass);


--
-- Name: track id; Type: DEFAULT; Schema: public; Owner: user
--

ALTER TABLE ONLY public.track ALTER COLUMN id SET DEFAULT nextval('public.track_id_seq'::regclass);


--
-- Name: user id; Type: DEFAULT; Schema: public; Owner: user
--

ALTER TABLE ONLY public."user" ALTER COLUMN id SET DEFAULT nextval('public.user_id_seq'::regclass);


--
-- Name: user_track id; Type: DEFAULT; Schema: public; Owner: user
--

ALTER TABLE ONLY public.user_track ALTER COLUMN id SET DEFAULT nextval('public.user_track_id_seq'::regclass);


--
-- Data for Name: message; Type: TABLE DATA; Schema: public; Owner: user
--

COPY public.message (id, room_id, user_id, content, created_at) FROM stdin;
1	1	5	мсч	2026-02-20 18:02:28.883693
2	1	5	счм	2026-02-20 18:02:35.112323
3	1	5	соси хуй	2026-02-20 18:02:38.842616
4	1	5	лол	2026-02-20 18:02:41.779814
5	1	8	гшшг	2026-02-20 18:03:01.191733
6	1	5	мчс	2026-02-20 18:03:08.447096
7	1	5	ттттт	2026-02-20 18:03:31.222612
8	1	8	рлолорлорло	2026-02-20 18:03:37.75075
9	1	5	лв	2026-02-24 17:22:57.322368
10	1	5	соси мой хуй тупая программа хайку	2026-02-24 17:23:12.097646
11	1	9	ываыв	2026-02-26 08:17:34.587016
12	1	5	ыАвавы	2026-02-26 08:17:40.039942
13	1	1	фвы	2026-02-26 13:17:10.954502
14	1	1	уц	2026-02-26 13:36:44.246438
15	1	1	ав	2026-02-26 18:12:43.155949
16	1	1	dfvds	2026-02-28 17:27:59.546008
17	1	1	газ	2026-02-28 19:24:45.739997
18	1	1	страпониться сучка	2026-02-28 19:27:13.786941
19	1	1	vbcfv	2026-03-01 15:44:41.105944
20	1	1	blbbb	2026-03-01 15:44:45.081467
21	1	1	сука	2026-03-01 15:45:30.816765
22	1	1	ахуенннаааа	2026-03-01 15:45:53.039241
\.


--
-- Data for Name: playlist; Type: TABLE DATA; Schema: public; Owner: user
--

COPY public.playlist (id, owner_id, name, description, thumbnail, is_album, source, source_playlist_id, is_public, track_count, total_duration, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: playlist_track; Type: TABLE DATA; Schema: public; Owner: user
--

COPY public.playlist_track (id, playlist_id, track_id, "order", added_at) FROM stdin;
\.


--
-- Data for Name: room; Type: TABLE DATA; Schema: public; Owner: user
--

COPY public.room (id, creator_id, name, description, is_active, created_at, updated_at, now_playing_track_id, playback_started_at, is_playing, queue_mode) FROM stdin;
4	4	Test Room	Комната для тестирования	t	2026-02-19 20:01:04.897867	2026-02-26 21:31:35.288139	\N	\N	f	loop
5	4	Test Room	Комната для тестирования	t	2026-02-19 20:02:32.980651	2026-02-26 21:31:35.28814	\N	\N	f	loop
6	4	SC Test Room	SoundCloud test room	t	2026-02-19 20:09:55.497027	2026-02-26 21:31:35.288141	\N	\N	f	loop
7	4	SC Test Room	SoundCloud test room	t	2026-02-19 20:11:00.538557	2026-02-26 21:31:35.288142	\N	\N	f	loop
8	4	SC Stream Test	Test SoundCloud streaming	t	2026-02-19 20:13:21.651248	2026-02-26 21:31:35.288143	\N	\N	f	loop
9	4	SC Stream Test	Test SoundCloud streaming	t	2026-02-19 20:13:29.577879	2026-02-26 21:31:35.288144	\N	\N	f	loop
10	5	SC Stream Test	Test SoundCloud streaming	t	2026-02-19 20:17:28.908919	2026-02-26 21:31:35.288145	\N	\N	f	loop
11	5	SC Stream Test	Test SoundCloud streaming	t	2026-02-19 20:17:31.952881	2026-02-26 21:31:35.288146	\N	\N	f	loop
12	5	SC Test 2	With page URL	t	2026-02-19 20:22:32.106904	2026-02-26 21:31:35.288147	\N	\N	f	loop
13	5	SoundCloud Test Room	Testing SoundCloud streaming	t	2026-02-19 20:24:40.816388	2026-02-26 21:31:35.288148	\N	\N	f	loop
14	5	SoundCloud Test Room	Testing SoundCloud streaming	t	2026-02-19 20:24:52.86132	2026-02-26 21:31:35.288149	\N	\N	f	loop
15	5	Test	Test	t	2026-02-19 20:27:46.671301	2026-02-26 21:31:35.28815	\N	\N	f	loop
16	5	Test	Test	t	2026-02-19 20:36:45.292691	2026-02-26 21:31:35.288151	\N	\N	f	loop
17	5	Test Room	\N	t	2026-02-19 20:41:35.050364	2026-02-26 21:31:35.288152	\N	\N	f	loop
18	5	Test Room	\N	t	2026-02-19 20:42:19.157437	2026-02-26 21:31:35.288153	\N	\N	f	loop
19	12	Test Room	test	t	2026-02-28 16:26:50.423585	2026-02-28 16:40:18.140378	\N	\N	f	loop
2	4	Test Room	Тестовая комната	t	2026-02-19 19:58:57.466456	2026-02-26 21:31:35.288131	\N	\N	f	loop
3	4	Test Room	Комната для тестирования	t	2026-02-19 20:01:04.254285	2026-02-26 21:31:35.288137	\N	\N	f	loop
1	1	Chill Vibes	Late night session	t	2026-02-19 15:36:16.371228	2026-03-01 19:28:50.63287	70	2026-03-01 18:38:51.398306	f	loop
\.


--
-- Data for Name: room_track; Type: TABLE DATA; Schema: public; Owner: user
--

COPY public.room_track (id, room_id, source, source_track_id, title, artist, duration, stream_url, "order", added_by_id, created_at, thumbnail, genre) FROM stdin;
69	1	SOUNDCLOUD	https://soundcloud.com/pittkiid/creator-1	Creator	Pittkiid	164.326	https://cf-media.sndcdn.com/LwaDygMOC0oE.128.mp3?Policy=eyJTdGF0ZW1lbnQiOlt7IlJlc291cmNlIjoiKjovL2NmLW1lZGlhLnNuZGNkbi5jb20vTHdhRHlnTU9DMG9FLjEyOC5tcDMqIiwiQ29uZGl0aW9uIjp7IkRhdGVMZXNzVGhhbiI6eyJBV1M6RXBvY2hUaW1lIjoxNzcyMzgyNTA1fX19XX0_&Signature=BbAHMB9CZA9UpyoX7RyxlNtIxTg~iS68dPspWY7Xp4au95dAKChQ07OL-m-y2~pWZQXM5nFYGVoPe1dIaUj9JJkfmoCBQ0iVWoyhaqNiARwktbsdlIXHDVzoEnToqaFF4mJb-Y4r8RabQkkax3B4BY2F25U2pJ0lKWgkjTW6Bd6Coy4JFcGbeUYeLN2hyC4cn4NsD-5awTeblrVpZE50~KezuFChsnjm99SdeGT0YAPfS-OMnSDPHkq6OGjHC5wt7szqn2pEGmwXe89jImDz~O2L7ovhRbVQzdwE0sMcngFUEItO~77477LhssQhjTicKudmozXJ2axZej20Zb-hwA__&Key-Pair-Id=APKAI6TU7MMXM5DG6EPQ	3	1	2026-02-28 19:28:54.033421	https://i1.sndcdn.com/artworks-EKPTVavBqu7cj7Cr-X6LK0Q-t500x500.jpg	Hip-hop & Rap
64	4	SOUNDCLOUD	https://soundcloud.com/test/track	Test Track	Test Artist	180		1	1	2026-02-28 08:47:12.85309	https://example.com/thumb.jpg	test
70	1	SOUNDCLOUD	https://soundcloud.com/pittkiid/kladu-w-mayot-2	Кладу w/ MAYOT	Pittkiid	206.878	https://cf-media.sndcdn.com/gHgnpQG5x9aC.128.mp3?Policy=eyJTdGF0ZW1lbnQiOlt7IlJlc291cmNlIjoiKjovL2NmLW1lZGlhLnNuZGNkbi5jb20vZ0hnbnBRRzV4OWFDLjEyOC5tcDMqIiwiQ29uZGl0aW9uIjp7IkRhdGVMZXNzVGhhbiI6eyJBV1M6RXBvY2hUaW1lIjoxNzcyMzgyNzIxfX19XX0_&Signature=DGmpZJQY67EBOP5uQNocgLE4~Z701jAeI8HQkhE28f8Vsy0aPvPsFtkEmdXBnH9WfTfXUjWjsw8Cgaq~5TBL0YZj8MEHJuAg8pU3CnyrHDfc6ah3PREbrn~aQOJ~M4qCaW0xjMrqEg0x-hHmuvi7OnVCavgMvpJhhv0nEwLNtB6ezbxNjX6Brsxrga27PGEU9ER3hAjF76qyCwoj~iqQR~-7ZBLDdiC9ZF3FE1N-9kedmetXhW~Ky51okI30-8KAwPfsAUIXRmo6Rhenec057njM4~MWpiSotWqqHtb4tcg8RaOn4seEgktBxen40zSJuYiv9No9byxDQkm3Vs-RrQ__&Key-Pair-Id=APKAI6TU7MMXM5DG6EPQ	2	1	2026-03-01 15:21:15.165076	https://i1.sndcdn.com/artworks-EKPTVavBqu7cj7Cr-X6LK0Q-t500x500.jpg	Hip-hop & Rap
\.


--
-- Data for Name: track; Type: TABLE DATA; Schema: public; Owner: user
--

COPY public.track (id, source, source_track_id, source_page_url, title, artist, album, duration, genre, year, stream_url, stream_url_expires_at, thumbnail_url, bitrate, codec, total_plays, unique_listeners, created_at, updated_at, local_file_path) FROM stdin;
1	SOUNDCLOUD	sake	sake	Unknown	\N	\N	\N	\N	\N		2026-03-02 19:40:05.615491	\N	128	mp3	0	0	2026-03-01 19:40:05.616914	2026-03-01 19:40:05.616917	\N
2	SOUNDCLOUD	f	f	Unknown	\N	\N	\N	\N	\N		2026-03-02 19:53:30.324339	\N	128	mp3	0	0	2026-03-01 19:53:30.326155	2026-03-01 19:53:30.326169	\N
3	SOUNDCLOUD	drugoi-3	https://soundcloud.com/pittkiid/drugoi-3	Другой	Pittkiid	\N	115.486	Hip-hop & Rap	\N	https://playback.media-streaming.soundcloud.cloud/cjQVomrCCCS3/aac_160k/169fb7e9-74c4-4db5-bbeb-0a1e8a11098d/playlist.m3u8?expires=1772402580&Policy=eyJTdGF0ZW1lbnQiOlt7IlJlc291cmNlIjoiaHR0cHM6Ly9wbGF5YmFjay5tZWRpYS1zdHJlYW1pbmcuc291bmRjbG91ZC5jbG91ZC9jalFWb21yQ0NDUzMvYWFjXzE2MGsvMTY5ZmI3ZTktNzRjNC00ZGI1LWJiZWItMGExZThhMTEwOThkL3BsYXlsaXN0Lm0zdTg~ZXhwaXJlcz0xNzcyNDAyNTgwIiwiQ29uZGl0aW9uIjp7IkRhdGVMZXNzVGhhbiI6eyJBV1M6RXBvY2hUaW1lIjoxNzcyMzk1NTAwfX19XX0_&Signature=xsoseMxA-kAZAfZG5p3nPBWlSKyspkPAXmOldWHBYhwWStpq-kd64VQXhdH6Q23--xGVsoVPw270fW5WmMW9y~N4eAdsMGW1DRNeuF89LuCZl6WZR4QVBucR~RPQ5PQXyN2aR3b3yFE-XWPW14029BaTCO0rahUHhEYLsZhJryRY6Gzo4TumWHrda71uwR0dvfj-2iXXV3gtsIqOpo~d-URdzoFTTyA4Zxm3iPxLOABKEeSFAZrPqYxP5oIi0C2L-hAExfXvfib8orZe63TivF4PAD6UBeH9fFQqFe296~ka-D2hXJws6c8G0mv8oc6H8KRqMYbDScdUkljT~wP2rw__&Key-Pair-Id=K34606QXLEIRF3	2026-03-02 20:01:15.596502	https://i1.sndcdn.com/artworks-EKPTVavBqu7cj7Cr-X6LK0Q-large.png	256	mp3	1	1	2026-03-01 20:01:15.602863	2026-03-01 20:01:36.614681	downloads/Другой.mp3
\.


--
-- Data for Name: user; Type: TABLE DATA; Schema: public; Owner: user
--

COPY public."user" (id, email, username, password_hash, role, is_blocked, can_create_rooms, created_at) FROM stdin;
2	user@example.com	string	$2b$12$7dPV6gHQHowRWb0BU14ieOk2WXmEuh7V9/ST7TSstb6eq5r54M1US	USER	f	t	2026-02-19 15:33:27.532127
3	was@asa.er	dss	$2b$12$xX6gkFzFDJZiZwoMQtdFieUbjTM3K/mZzDWAE8JNTdNypHfIXFHr.	USER	f	t	2026-02-19 19:22:50.702257
4	test1771531131@test.com	testuser1771531131	$2b$12$jBryACQW8okTwlleYvE3V.Q/bC/0bn0Fl68sVaPL3yt9vyt1MXWjm	USER	f	t	2026-02-19 19:58:51.749889
5	test123@test.com	testuser123	$2b$12$Tx3AGtbJ02DA.n1BYEBjUeK1n0ugI4qjJEnoUnGRHPY2/CyxyzVsu	USER	f	t	2026-02-19 20:17:28.508514
6	test1771532678@test.com	user1771532678	$2b$12$mow8/XPv5uYugxnynAbb5exvafRHYlsVuBMe8MuXdcwQ3nqKYRTLW	USER	f	t	2026-02-19 20:24:39.15984
7	test1771532691@test.com	user1771532691	$2b$12$lI0aKopyXrRT.CZopvnWC.OKQ0gU7ls7wuJATN6cVPnsR.iQMKRuG	USER	f	t	2026-02-19 20:24:51.427151
8	test456@test.com	\N	$2b$12$MMNGH60O/nbRL13i6JKAnO.r3MeTYmLbdc.pABKkY/kJq6lon0.ne	\N	\N	\N	2026-02-26 07:13:36.406956
9	regular@test.com	regular_user	$2b$12$MEGfT0NUBhfxTEAYQZMuvO9kDzFZIskQvN/4TfdSYWaAHHjHkLDza	USER	f	f	2026-02-26 07:13:36.406956
1	test@example.com	testuser	$2b$12$8F86X/1o7sYipD3uz/ptKOTTkCLl6qq2PPhQX0VFBi1m6JB7A5pEG	USER	f	t	2026-02-19 15:32:55.53814
11	test2@test.com	testuser2	$2b$12$5KblgHeF9NHNyspI2jFqD.fiRIqXtlJx9Hct3sLZ0Qpu9A8rqiuVi	USER	f	t	2026-02-28 16:26:29.931091
12	tester@test.com	tester	$2b$12$nWFjFAi4OWE0rIZWtP9hr.O/OtJ5OKC.J6eQ2S6EHRr5XH581ewS6	USER	f	t	2026-02-28 16:26:49.974162
13	demo@example.com	demo	$2b$12$0pSTW8Z1K8.5rhHTbxAmsOm./VBVtRk0h7kwy611h.8KLkFFeDd.C	USER	f	t	2026-03-01 19:39:26.863093
\.


--
-- Data for Name: user_room; Type: TABLE DATA; Schema: public; Owner: user
--

COPY public.user_room (user_id, room_id, joined_at, role, is_banned) FROM stdin;
4	4	2026-02-19 20:01:07.184297	user	f
4	5	2026-02-19 20:02:35.443257	user	f
\.


--
-- Data for Name: user_track; Type: TABLE DATA; Schema: public; Owner: user
--

COPY public.user_track (id, user_id, track_id, added_at, is_favorite, play_count, last_played_at, user_rating, user_notes) FROM stdin;
3	13	3	2026-03-01 20:01:15.626029	f	1	2026-03-01 20:01:36.598824	\N	\N
\.


--
-- Name: message_id_seq; Type: SEQUENCE SET; Schema: public; Owner: user
--

SELECT pg_catalog.setval('public.message_id_seq', 22, true);


--
-- Name: playlist_id_seq; Type: SEQUENCE SET; Schema: public; Owner: user
--

SELECT pg_catalog.setval('public.playlist_id_seq', 1, false);


--
-- Name: playlist_track_id_seq; Type: SEQUENCE SET; Schema: public; Owner: user
--

SELECT pg_catalog.setval('public.playlist_track_id_seq', 1, false);


--
-- Name: room_id_seq; Type: SEQUENCE SET; Schema: public; Owner: user
--

SELECT pg_catalog.setval('public.room_id_seq', 19, true);


--
-- Name: room_track_id_seq; Type: SEQUENCE SET; Schema: public; Owner: user
--

SELECT pg_catalog.setval('public.room_track_id_seq', 70, true);


--
-- Name: track_id_seq; Type: SEQUENCE SET; Schema: public; Owner: user
--

SELECT pg_catalog.setval('public.track_id_seq', 3, true);


--
-- Name: user_id_seq; Type: SEQUENCE SET; Schema: public; Owner: user
--

SELECT pg_catalog.setval('public.user_id_seq', 13, true);


--
-- Name: user_track_id_seq; Type: SEQUENCE SET; Schema: public; Owner: user
--

SELECT pg_catalog.setval('public.user_track_id_seq', 3, true);


--
-- Name: message message_pkey; Type: CONSTRAINT; Schema: public; Owner: user
--

ALTER TABLE ONLY public.message
    ADD CONSTRAINT message_pkey PRIMARY KEY (id);


--
-- Name: playlist playlist_pkey; Type: CONSTRAINT; Schema: public; Owner: user
--

ALTER TABLE ONLY public.playlist
    ADD CONSTRAINT playlist_pkey PRIMARY KEY (id);


--
-- Name: playlist_track playlist_track_pkey; Type: CONSTRAINT; Schema: public; Owner: user
--

ALTER TABLE ONLY public.playlist_track
    ADD CONSTRAINT playlist_track_pkey PRIMARY KEY (id);


--
-- Name: room room_pkey; Type: CONSTRAINT; Schema: public; Owner: user
--

ALTER TABLE ONLY public.room
    ADD CONSTRAINT room_pkey PRIMARY KEY (id);


--
-- Name: room_track room_track_pkey; Type: CONSTRAINT; Schema: public; Owner: user
--

ALTER TABLE ONLY public.room_track
    ADD CONSTRAINT room_track_pkey PRIMARY KEY (id);


--
-- Name: track track_pkey; Type: CONSTRAINT; Schema: public; Owner: user
--

ALTER TABLE ONLY public.track
    ADD CONSTRAINT track_pkey PRIMARY KEY (id);


--
-- Name: playlist_track uq_playlist_track; Type: CONSTRAINT; Schema: public; Owner: user
--

ALTER TABLE ONLY public.playlist_track
    ADD CONSTRAINT uq_playlist_track UNIQUE (playlist_id, track_id);


--
-- Name: track uq_track_source; Type: CONSTRAINT; Schema: public; Owner: user
--

ALTER TABLE ONLY public.track
    ADD CONSTRAINT uq_track_source UNIQUE (source, source_track_id);


--
-- Name: user_track uq_user_track; Type: CONSTRAINT; Schema: public; Owner: user
--

ALTER TABLE ONLY public.user_track
    ADD CONSTRAINT uq_user_track UNIQUE (user_id, track_id);


--
-- Name: user user_pkey; Type: CONSTRAINT; Schema: public; Owner: user
--

ALTER TABLE ONLY public."user"
    ADD CONSTRAINT user_pkey PRIMARY KEY (id);


--
-- Name: user_track user_track_pkey; Type: CONSTRAINT; Schema: public; Owner: user
--

ALTER TABLE ONLY public.user_track
    ADD CONSTRAINT user_track_pkey PRIMARY KEY (id);


--
-- Name: ix_message_id; Type: INDEX; Schema: public; Owner: user
--

CREATE INDEX ix_message_id ON public.message USING btree (id);


--
-- Name: ix_playlist_id; Type: INDEX; Schema: public; Owner: user
--

CREATE INDEX ix_playlist_id ON public.playlist USING btree (id);


--
-- Name: ix_playlist_track_id; Type: INDEX; Schema: public; Owner: user
--

CREATE INDEX ix_playlist_track_id ON public.playlist_track USING btree (id);


--
-- Name: ix_room_id; Type: INDEX; Schema: public; Owner: user
--

CREATE INDEX ix_room_id ON public.room USING btree (id);


--
-- Name: ix_room_name; Type: INDEX; Schema: public; Owner: user
--

CREATE INDEX ix_room_name ON public.room USING btree (name);


--
-- Name: ix_room_track_id; Type: INDEX; Schema: public; Owner: user
--

CREATE INDEX ix_room_track_id ON public.room_track USING btree (id);


--
-- Name: ix_track_id; Type: INDEX; Schema: public; Owner: user
--

CREATE INDEX ix_track_id ON public.track USING btree (id);


--
-- Name: ix_user_email; Type: INDEX; Schema: public; Owner: user
--

CREATE UNIQUE INDEX ix_user_email ON public."user" USING btree (email);


--
-- Name: ix_user_id; Type: INDEX; Schema: public; Owner: user
--

CREATE INDEX ix_user_id ON public."user" USING btree (id);


--
-- Name: ix_user_track_id; Type: INDEX; Schema: public; Owner: user
--

CREATE INDEX ix_user_track_id ON public.user_track USING btree (id);


--
-- Name: ix_user_username; Type: INDEX; Schema: public; Owner: user
--

CREATE UNIQUE INDEX ix_user_username ON public."user" USING btree (username);


--
-- Name: message message_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: user
--

ALTER TABLE ONLY public.message
    ADD CONSTRAINT message_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.room(id);


--
-- Name: message message_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: user
--

ALTER TABLE ONLY public.message
    ADD CONSTRAINT message_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id);


--
-- Name: playlist playlist_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: user
--

ALTER TABLE ONLY public.playlist
    ADD CONSTRAINT playlist_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public."user"(id);


--
-- Name: playlist_track playlist_track_playlist_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: user
--

ALTER TABLE ONLY public.playlist_track
    ADD CONSTRAINT playlist_track_playlist_id_fkey FOREIGN KEY (playlist_id) REFERENCES public.playlist(id);


--
-- Name: playlist_track playlist_track_track_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: user
--

ALTER TABLE ONLY public.playlist_track
    ADD CONSTRAINT playlist_track_track_id_fkey FOREIGN KEY (track_id) REFERENCES public.track(id);


--
-- Name: room room_creator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: user
--

ALTER TABLE ONLY public.room
    ADD CONSTRAINT room_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public."user"(id);


--
-- Name: room room_now_playing_track_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: user
--

ALTER TABLE ONLY public.room
    ADD CONSTRAINT room_now_playing_track_id_fkey FOREIGN KEY (now_playing_track_id) REFERENCES public.room_track(id);


--
-- Name: room_track room_track_added_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: user
--

ALTER TABLE ONLY public.room_track
    ADD CONSTRAINT room_track_added_by_id_fkey FOREIGN KEY (added_by_id) REFERENCES public."user"(id);


--
-- Name: room_track room_track_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: user
--

ALTER TABLE ONLY public.room_track
    ADD CONSTRAINT room_track_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.room(id);


--
-- Name: user_room user_room_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: user
--

ALTER TABLE ONLY public.user_room
    ADD CONSTRAINT user_room_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.room(id);


--
-- Name: user_room user_room_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: user
--

ALTER TABLE ONLY public.user_room
    ADD CONSTRAINT user_room_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id);


--
-- Name: user_track user_track_track_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: user
--

ALTER TABLE ONLY public.user_track
    ADD CONSTRAINT user_track_track_id_fkey FOREIGN KEY (track_id) REFERENCES public.track(id);


--
-- Name: user_track user_track_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: user
--

ALTER TABLE ONLY public.user_track
    ADD CONSTRAINT user_track_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id);


--
-- PostgreSQL database dump complete
--

\unrestrict Q1scbpABV6MqEMl9OmZgloKcu0L17YNslRDkCfWbH84uBWpkYVclego0w7S64q7

