import type { Horario } from "../../interfaces/professional.interface";

export function isOpen(schedule: Horario): boolean {
    const now = new Date();

    // 1. Map JavaScript getDay() (0 = Sunday, 1 = Monday...) to your interface keys
    const daysOfWeek = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'] as const;
    const currentDay = daysOfWeek[now.getDay()]; // e.g., 'lunes'

    // 2. Get today's hours from the schedule
    const todayHours = schedule[currentDay];
    if (!todayHours) return false; // If it's null, it's closed

    // 3. Get current time in "HH:MM" format (Spain Timezone)
    const currentTime = now.toLocaleTimeString('es-ES', {
        timeZone: 'Europe/Madrid',
        hour: '2-digit',
        minute: '2-digit'
    }); // e.g., "15:30"

    // 4. Split the string into open and close times (e.g., "09:00-20:00")
    const [openTime, closeTime] = todayHours.split('-');

    // 5. Check if current time is between open and close times
    return currentTime >= openTime.trim() && currentTime <= closeTime.trim();
}