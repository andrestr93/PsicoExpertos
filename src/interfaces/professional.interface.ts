// src/types/profesional.ts

export interface SocialMedia {
    instagram: string | null
    facebook: string | null
    twitter: string | null
    linkedin: string | null
    yelp: string | null
    youtube: string | null
}

export interface GooglePlaces {
    place_id: string
    cid: string
    category: string
    review_count: number | null
    average_rating: number | null
    latitude: number
    longitude: number
}

export interface Horario {
    lunes: string | null
    martes: string | null
    miercoles: string | null
    jueves: string | null
    viernes: string | null
    sabado: string | null
    domingo: string | null
}

export interface Meta {
    slug: string
    especialidad_slug: string
    municipio_slug: string
    provincia_slug: string
    especialidad: string
    municipio: string
    provincia: string
    calle: string
    cp: string
    url: string
    schema_rating: boolean
    title_seo: string
    desc_seo: string
}

export interface Profesional {
    name: string
    phone: string | null
    email: string | null
    website: string | null
    address: string
    social_media: SocialMedia
    google_places: GooglePlaces
    tags: string[],
    horario: Horario
    _meta?: Meta
}