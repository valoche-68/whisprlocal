export function useAuth() {
  return {
    isSignedIn: false,
    isGracePeriodOnly: false,
    isLoaded: true,
    session: null as { user: { id: string } } | null,
    user: null as {
      id: string;
      name: string;
      email: string;
      emailVerified?: boolean;
      image?: string | null;
    } | null,
    refetch: async () => null,
  };
}
