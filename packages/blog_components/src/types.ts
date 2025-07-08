export interface BlogPost {
  id: string;
  title: string;
  content: string;
  author: string;
  date: string;
  tags?: string[];
  slug?: string;
  excerpt?: string;
}