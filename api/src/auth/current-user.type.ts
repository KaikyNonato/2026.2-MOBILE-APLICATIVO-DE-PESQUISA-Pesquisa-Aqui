import { Profile } from "../user/dto/create-user.dto";

export type UserPayLoad = {
  sub: number;
  username: string;
  profile: Profile;
  companyId: number | null;
};
