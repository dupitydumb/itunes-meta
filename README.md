# iTunes Metadata for Audion v1.5.0+

A reference implementation of Audion's typed `MetadataProvider` interface, providing catalog search, high-res artwork resolution, and entity details for Audion's universal search and 3-Tier Smart Playlist Importer.

---

## Overview

Audion 1.5.0 introduces the `MetadataProvider` interface in `src/lib/plugins/providers.ts`:

```typescript
export interface MetadataProvider {
    id: string;
    name: string;
    version?: string;
    description?: string;
    search(query: string, type?: 'all' | 'track' | 'album' | 'artist', page?: number): Promise<MetadataSearchResult>;
    getAlbum?(id: string): Promise<any>;
    getArtist?(id: string): Promise<any>;
    getTrack?(id: string): Promise<MetadataTrackItem | null>;
}
```

---

## Features Demonstrated

1. **Universal Search**:
   - Implements `search(query, type, page)` supporting `'all'`, `'track'`, `'album'`, and `'artist'`.
   - Returns structured `MetadataSearchResult` with normalized items.
2. **Entity Details**:
   - Implements `getTrack(id)` and `getAlbum(id)` returning full track listings and metadata.
3. **High-Res Cover Artwork**:
   - Demonstrates regex-based artwork upgrading from default low-res CDN thumbnails to 1000x1000 high-res album covers.
4. **Integration with Smart Playlist Importer**:
   - Provides normalized `title`, `artist`, `album`, and `duration` (in seconds) used by Audion's Tier 3 waterfall matcher to resolve missing songs.

---

## How to Register

In your plugin's `init(api)` lifecycle hook:

```javascript
async init(api) {
  api.metadata.registerProvider({
    id: 'my-metadata-provider',
    name: 'My Metadata Provider',
    version: '1.0.0',
    description: 'Catalog provider',
    search: async (query, type, page) => {
      return { tracks: [], albums: [], artists: [] };
    },
    getTrack: async (id) => { /* ... */ },
    getAlbum: async (id) => { /* ... */ }
  });
}
```
