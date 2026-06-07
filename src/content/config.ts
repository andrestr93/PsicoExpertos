import { defineCollection, z } from 'astro:content';

const profesionalesCollection = defineCollection({
    type: 'data',
    schema: z.object({
        name: z.string(),
        phone: z.string(),
        email: z.string().email().nullable(),
        website: z.string().url().nullable(),
        address: z.string(),
        social_media: z.object({
            instagram: z.string().nullable(),
            facebook: z.string().nullable(),
            twitter: z.string().nullable(),
            linkedin: z.string().nullable(),
            yelp: z.string().nullable(),
            youtube: z.string().nullable(),
        }),
        google_places: z.object({
            place_id: z.string(),
            cid: z.string(),
            category: z.string(),
            review_count: z.number(),
            average_rating: z.number(),
            latitude: z.number(),
            longitude: z.number(),
        }),
        horario: z.object({
            lunes: z.string().nullable(),
            martes: z.string().nullable(),
            miercoles: z.string().nullable(),
            jueves: z.string().nullable(),
            viernes: z.string().nullable(),
            sabado: z.string().nullable(),
            domingo: z.string().nullable(),
        }),
    }),
});

export const collections = {
    'profesionales': profesionalesCollection,
};