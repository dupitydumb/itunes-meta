// iTunes Metadata for Audion v1.5.0+
// Demonstrates how to build a catalog and metadata provider that interfaces with
// Audion's search, library metadata enrichment, and the 3-Tier Smart Playlist Importer.

(function () {
  'use strict';

  const PROVIDER_ID = 'itunes-metadata';
  const PROVIDER_NAME = 'iTunes Metadata';
  const ITUNES_BASE = 'https://itunes.apple.com';

  const iTunesMetadataProvider = {
    id: PROVIDER_ID,
    name: PROVIDER_NAME,
    version: '1.0.0',
    description: 'Reference catalog search and metadata provider querying public music databases with high-res artwork.',
    api: null,

    /**
     * Initializes the plugin and registers the MetadataProvider into Audion's ProviderRegistry.
     * @param {object} api - Audion Plugin API instance
     */
    async init(api) {
      this.api = api;

      if (api.metadata && typeof api.metadata.registerProvider === 'function') {
        api.metadata.registerProvider({
          id: this.id,
          name: this.name,
          version: this.version,
          description: this.description,
          search: (query, type, page) => this.search(query, type, page),
          getTrack: (id) => this.getTrack(id),
          getAlbum: (id) => this.getAlbum(id),
          getArtist: (id) => this.getArtist(id)
        });
        console.log(`[${PROVIDER_NAME}] Successfully registered MetadataProvider '${this.id}'`);
      } else {
        console.warn(`[${PROVIDER_NAME}] api.metadata.registerProvider is not available`);
      }
    },

    /**
     * Searches tracks, albums, or artists based on query and type.
     * @param {string} query - Search term (e.g., "Daft Punk Get Lucky")
     * @param {'all' | 'track' | 'album' | 'artist'} [type='all'] - Entity filter
     * @param {number} [page=1] - 1-based page index
     * @returns {Promise<{ tracks?: Array<object>, albums?: Array<object>, artists?: Array<object> }>}
     */
    async search(query, type = 'all', page = 1) {
      if (!query || !query.trim()) {
        return { tracks: [], albums: [], artists: [] };
      }

      const limit = 25;
      const offset = (page - 1) * limit;

      // Map Audion type to iTunes entity parameter
      let entityParam = 'song,album,musicArtist';
      if (type === 'track') entityParam = 'song';
      else if (type === 'album') entityParam = 'album';
      else if (type === 'artist') entityParam = 'musicArtist';

      const searchUrl = `${ITUNES_BASE}/search?term=${encodeURIComponent(query.trim())}&entity=${entityParam}&limit=${limit}&offset=${offset}&media=music`;

      try {
        console.log(`[${PROVIDER_NAME}] Searching '${query}' (Type: ${type}, Page: ${page})`);
        const res = await this._fetch(searchUrl);
        if (!res.ok) {
          console.warn(`[${PROVIDER_NAME}] Search failed with HTTP ${res.status}`);
          return { tracks: [], albums: [], artists: [] };
        }

        const data = await res.json();
        const results = data.results || [];

        const tracks = [];
        const albums = [];
        const artists = [];

        for (const item of results) {
          if (item.wrapperType === 'track' && item.kind === 'song') {
            tracks.push(this._normalizeTrack(item));
          } else if (item.wrapperType === 'collection' && item.collectionType === 'Album') {
            albums.push(this._normalizeAlbum(item));
          } else if (item.wrapperType === 'artist') {
            artists.push(this._normalizeArtist(item));
          }
        }

        return { tracks, albums, artists };
      } catch (err) {
        console.error(`[${PROVIDER_NAME}] Search error:`, err);
        return { tracks: [], albums: [], artists: [] };
      }
    },

    /**
     * Retrieves full metadata for an individual track by ID.
     * @param {string} id - Catalog Track ID
     * @returns {Promise<object | null>}
     */
    async getTrack(id) {
      if (!id) return null;
      try {
        const cleanId = String(id).replace(/^track-/, '');
        const url = `${ITUNES_BASE}/lookup?id=${encodeURIComponent(cleanId)}&entity=song`;
        const res = await this._fetch(url);
        if (!res.ok) return null;

        const data = await res.json();
        const item = (data.results || []).find(r => r.wrapperType === 'track');
        return item ? this._normalizeTrack(item) : null;
      } catch (err) {
        console.error(`[${PROVIDER_NAME}] getTrack error:`, err);
        return null;
      }
    },

    /**
     * Retrieves full metadata and tracklist for an album.
     * Strips 'album-' or 'title-' prefixes and falls back to query search if ID lookup fails.
     * @param {string} id - Album Collection ID or title
     * @returns {Promise<object | null>}
     */
    async getAlbum(id) {
      if (!id) return null;
      try {
        const cleanId = String(id).replace(/^album-/, '').replace(/^title-/, '');
        let albumItem = null;
        let tracks = [];

        // 1. If cleanId is numeric, try direct iTunes collection lookup
        if (/^\d+$/.test(cleanId)) {
          const url = `${ITUNES_BASE}/lookup?id=${encodeURIComponent(cleanId)}&entity=song&limit=50`;
          const res = await this._fetch(url);
          if (res.ok) {
            const data = await res.json();
            const results = data.results || [];
            albumItem = results.find(r => r.wrapperType === 'collection');
            tracks = results
              .filter(r => r.wrapperType === 'track' && (r.kind === 'song' || !r.kind))
              .map(t => this._normalizeTrack(t));
          }
        }

        // 2. If no tracks found (or cleanId is non-numeric/title), fallback to iTunes search
        if (!tracks.length) {
          const query = decodeURIComponent(cleanId).trim();
          const searchUrl = `${ITUNES_BASE}/search?term=${encodeURIComponent(query)}&entity=song&limit=25&media=music`;
          const sRes = await this._fetch(searchUrl);
          if (sRes.ok) {
            const sData = await sRes.json();
            const results = sData.results || [];
            tracks = results
              .filter(r => r.wrapperType === 'track')
              .map(t => this._normalizeTrack(t));
            if (!albumItem && results.length) {
              const firstWithAlbum = results.find(r => r.collectionId || r.collectionName);
              if (firstWithAlbum) {
                albumItem = {
                  collectionId: firstWithAlbum.collectionId,
                  collectionName: firstWithAlbum.collectionName || query,
                  artistName: firstWithAlbum.artistName,
                  artworkUrl100: firstWithAlbum.artworkUrl100,
                  releaseDate: firstWithAlbum.releaseDate,
                  trackCount: tracks.length,
                  primaryGenreName: firstWithAlbum.primaryGenreName
                };
              }
            }
          }
        }

        if (!albumItem && !tracks.length) return null;
        const album = albumItem ? this._normalizeAlbum(albumItem) : {
          id: cleanId,
          title: decodeURIComponent(cleanId),
          artist: 'Unknown Artist',
          source_type: 'itunes',
          provider_id: this.id,
          tracks
        };
        return { ...album, tracks };
      } catch (err) {
        console.error(`[${PROVIDER_NAME}] getAlbum error:`, err);
        return null;
      }
    },

    /**
     * Retrieves artist details with top tracks and albums.
     * Strips 'artist-' or 'name-' prefixes and falls back to query search if ID lookup fails.
     * @param {string} id - Artist ID or name
     * @returns {Promise<object | null>}
     */
    async getArtist(id) {
      if (!id) return null;
      try {
        const cleanId = String(id).replace(/^artist-/, '').replace(/^name-/, '');
        let artistItem = null;
        let tracks = [];
        let albums = [];

        // 1. If numeric, lookup artist songs and albums directly
        if (/^\d+$/.test(cleanId)) {
          const [songRes, albumRes] = await Promise.all([
            this._fetch(`${ITUNES_BASE}/lookup?id=${encodeURIComponent(cleanId)}&entity=song&limit=25`).catch(() => null),
            this._fetch(`${ITUNES_BASE}/lookup?id=${encodeURIComponent(cleanId)}&entity=album&limit=25`).catch(() => null)
          ]);
          if (songRes && songRes.ok) {
            const data = await songRes.json();
            const results = data.results || [];
            artistItem = results.find(r => r.wrapperType === 'artist') || artistItem;
            tracks = results.filter(r => r.wrapperType === 'track' && r.kind === 'song').map(t => this._normalizeTrack(t));
          }
          if (albumRes && albumRes.ok) {
            const data = await albumRes.json();
            const results = data.results || [];
            artistItem = results.find(r => r.wrapperType === 'artist') || artistItem;
            albums = results.filter(r => r.wrapperType === 'collection' && r.collectionType === 'Album').map(a => this._normalizeAlbum(a));
          }
        }

        // 2. If no tracks/albums (or non-numeric name query), fallback to iTunes search
        if (!tracks.length) {
          const query = decodeURIComponent(cleanId).trim();
          const [songRes, albumRes] = await Promise.all([
            this._fetch(`${ITUNES_BASE}/search?term=${encodeURIComponent(query)}&entity=song&limit=25&media=music`).catch(() => null),
            this._fetch(`${ITUNES_BASE}/search?term=${encodeURIComponent(query)}&entity=album&limit=25&media=music`).catch(() => null)
          ]);
          if (songRes && songRes.ok) {
            const data = await songRes.json();
            tracks = (data.results || []).filter(r => r.wrapperType === 'track').map(t => this._normalizeTrack(t));
          }
          if (albumRes && albumRes.ok) {
            const data = await albumRes.json();
            albums = (data.results || []).filter(r => r.wrapperType === 'collection').map(a => this._normalizeAlbum(a));
          }
        }

        const baseArtist = artistItem ? this._normalizeArtist(artistItem) : {
          id: cleanId,
          name: decodeURIComponent(cleanId),
          source_type: 'itunes',
          provider_id: this.id
        };

        return { ...baseArtist, tracks, albums };
      } catch (err) {
        console.error(`[${PROVIDER_NAME}] getArtist error:`, err);
        return null;
      }
    },

    /**
     * Normalizes a raw track into Audion's MetadataTrackItem interface.
     * @private
     */
    _normalizeTrack(item) {
      const trackId = item.trackId ? String(item.trackId) : '';
      const artistId = item.artistId ? String(item.artistId) : '';
      const albumId = item.collectionId ? String(item.collectionId) : '';

      return {
        id: trackId ? `track-${trackId}` : `track-${Date.now()}-${Math.random()}`,
        external_id: trackId,
        source_type: 'itunes',
        provider_id: this.id,
        title: item.trackName || 'Unknown Title',
        artist: item.artistName || 'Unknown Artist',
        album: item.collectionName || 'Unknown Album',
        duration: item.trackTimeMillis ? Math.round(item.trackTimeMillis / 1000) : 0,
        cover_url: this._upgradeCover(item.artworkUrl100),
        track_number: item.trackNumber || 1,
        disc_number: item.discNumber || 1,
        genre: item.primaryGenreName,
        release_date: item.releaseDate,
        preview_url: item.previewUrl,
        artist_id: artistId,
        album_id: albumId,
      };
    },

    /**
     * Normalizes a collection into Audion's MetadataAlbumItem interface.
     * @private
     */
    _normalizeAlbum(item) {
      const albumId = item.collectionId ? String(item.collectionId) : '';
      const artistId = item.artistId ? String(item.artistId) : '';

      return {
        id: albumId,
        album_id: albumId,
        title: item.collectionName || 'Unknown Album',
        artist: item.artistName || 'Unknown Artist',
        artist_id: artistId,
        cover_url: this._upgradeCover(item.artworkUrl100),
        year: item.releaseDate ? new Date(item.releaseDate).getFullYear() : undefined,
        track_count: item.trackCount || 0,
        genre: item.primaryGenreName,
        source_type: 'itunes',
        provider_id: this.id,
      };
    },

    /**
     * Normalizes an artist into Audion's MetadataArtistItem interface.
     * @private
     */
    _normalizeArtist(item) {
      const artistId = item.artistId ? String(item.artistId) : '';

      return {
        id: artistId,
        artist_id: artistId,
        name: item.artistName || 'Unknown Artist',
        genre: item.primaryGenreName,
        url: item.artistLinkUrl,
        source_type: 'itunes',
        provider_id: this.id,
      };
    },

    /**
     * Upgrades low-res 100x100 thumbnails to high-res 1000x1000 artwork URLs.
     * @private
     */
    _upgradeCover(url) {
      if (!url || typeof url !== 'string') return '';
      return url.replace(/100x100bb\.(jpg|png|webp)/i, '1000x1000bb.$1');
    },

    /**
     * Internal fetch helper routing through api.fetch if available.
     * @private
     */
    async _fetch(url, opts) {
      if (this.api && typeof this.api.fetch === 'function') {
        return await this.api.fetch(url, opts);
      }
      return await fetch(url, opts);
    }
  };

  // Register with Audion runtime & global environment
  if (typeof Audion !== 'undefined' && Audion.register) {
    Audion.register(iTunesMetadataProvider);
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.iTunesMetadataProvider = iTunesMetadataProvider;
    globalThis.AudionPlugin = iTunesMetadataProvider;
  }
  if (typeof window !== 'undefined') {
    window.iTunesMetadataProvider = iTunesMetadataProvider;
    window.AudionPlugin = iTunesMetadataProvider;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = iTunesMetadataProvider;
  }
})();
